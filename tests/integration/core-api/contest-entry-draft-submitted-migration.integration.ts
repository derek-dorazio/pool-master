/**
 * #481 — the migration that splits an entry's ACTIVE status into DRAFT and SUBMITTED, run against
 * the rows it exists to rewrite.
 *
 * The test database is already past the migration, so ACTIVE no longer exists in it. Each case
 * therefore builds the tables the migration reads or writes, as they stood before it, in a
 * throwaway schema of its own, seeds them, and runs the real `migration.sql` with that schema
 * first on the search path. Only the columns the migration touches are recreated.
 *
 * What is asserted is where each existing entry lands:
 *   - on a contest that has started or finished, every ACTIVE entry is SUBMITTED, so live and
 *     settled results do not change, whatever its lineup;
 *   - on a contest that has not started, an ACTIVE entry is SUBMITTED only with a complete
 *     lineup, and is otherwise a DRAFT, so no incomplete entry is in play at tee-off;
 *   - INACTIVE entries stay INACTIVE, and new entries default to DRAFT.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../../packages/core-api/prisma/migrations/20261008140000_contest_entry_draft_and_submitted/migration.sql'),
  'utf8',
);

/** The migration's statements, comments stripped. No statement contains a semicolon of its own. */
const MIGRATION_STATEMENTS = MIGRATION_SQL
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

const PRE_MIGRATION_TABLES = [
  `CREATE TYPE "PrismaContestEntryStatus" AS ENUM ('ACTIVE', 'INACTIVE')`,
  `CREATE TABLE "sport_event_tiers" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "sport_event_id" uuid NOT NULL,
    "tier_number" integer NOT NULL
  )`,
  `CREATE TABLE "sport_event_participant_valuations" (
    "sport_event_participant_id" uuid PRIMARY KEY,
    "sport_event_tier_id" uuid REFERENCES "sport_event_tiers" ("id")
  )`,
  `CREATE TABLE "contests" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "sport_event_id" uuid,
    "status" text NOT NULL,
    "selection_type" text NOT NULL
  )`,
  `CREATE TABLE "contest_configurations" (
    "contest_id" uuid PRIMARY KEY REFERENCES "contests" ("id"),
    "config_json" jsonb,
    "roster_size" integer
  )`,
  `CREATE TABLE "contest_entries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "contest_id" uuid NOT NULL REFERENCES "contests" ("id"),
    "name" text NOT NULL,
    "status" "PrismaContestEntryStatus" NOT NULL DEFAULT 'ACTIVE'
  )`,
  `CREATE TABLE "contest_entry_picks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "entry_id" uuid NOT NULL REFERENCES "contest_entries" ("id"),
    "sport_event_participant_id" uuid NOT NULL
  )`,
];

type ContestStatus = 'DRAFT' | 'OPEN' | 'DRAFTING' | 'LOCKED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

interface SeedEntry {
  name: string;
  contestStatus: ContestStatus;
  status?: 'ACTIVE' | 'INACTIVE';
  /**
   * A tiered contest on an event with two tiers. `picksPerTier` is the contest's, and each number
   * in `picksByTier` is how many of the entry's golfers sit in that tier (1-based); 0 is a golfer
   * in no tier.
   */
  tiered?: { picksPerTier?: number; picksByTier: number[] };
  /** A budget contest with `rosterSize` and `picks` saved. */
  budget?: { rosterSize: number; picks: number };
}

/** Seeds pre-migration rows in a scratch schema, runs the migration there, and reads each entry's status back. */
async function migrate(entries: SeedEntry[]): Promise<{ statusByName: Map<string, string>; defaultStatus: string }> {
  const schema = `mig481_${randomUUID().replace(/-/g, '')}`;
  return getPrisma().$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
    for (const statement of PRE_MIGRATION_TABLES) {
      await tx.$executeRawUnsafe(statement);
    }

    for (const seed of entries) {
      const eventId = randomUUID();
      const tierIds: string[] = [];
      if (seed.tiered) {
        for (const tierNumber of [1, 2]) {
          const [{ id }] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            `INSERT INTO "sport_event_tiers" ("sport_event_id", "tier_number") VALUES ($1::uuid, $2) RETURNING "id"`,
            eventId, tierNumber,
          );
          tierIds.push(id);
        }
      }
      const [{ id: contestId }] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "contests" ("sport_event_id", "status", "selection_type") VALUES ($1::uuid, $2, $3) RETURNING "id"`,
        eventId, seed.contestStatus, seed.budget ? 'BUDGET_PICK' : 'TIERED',
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "contest_configurations" ("contest_id", "config_json", "roster_size") VALUES ($1::uuid, $2::jsonb, $3)`,
        contestId,
        JSON.stringify(seed.tiered?.picksPerTier === undefined ? { countedScores: 2 } : { picksPerTier: seed.tiered.picksPerTier, countedScores: 2 }),
        seed.budget?.rosterSize ?? null,
      );
      const [{ id: entryId }] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "contest_entries" ("contest_id", "name", "status") VALUES ($1::uuid, $2, $3::"PrismaContestEntryStatus") RETURNING "id"`,
        contestId, seed.name, seed.status ?? 'ACTIVE',
      );

      const pickTiers = seed.tiered?.picksByTier ?? Array.from({ length: seed.budget?.picks ?? 0 }, () => 0);
      for (const tierNumber of pickTiers) {
        const sportEventParticipantId = randomUUID();
        await tx.$executeRawUnsafe(
          `INSERT INTO "sport_event_participant_valuations" ("sport_event_participant_id", "sport_event_tier_id") VALUES ($1::uuid, $2::uuid)`,
          sportEventParticipantId, tierNumber > 0 ? tierIds[tierNumber - 1] : null,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "contest_entry_picks" ("entry_id", "sport_event_participant_id") VALUES ($1::uuid, $2::uuid)`,
          entryId, sportEventParticipantId,
        );
      }
    }

    for (const statement of MIGRATION_STATEMENTS) {
      await tx.$executeRawUnsafe(statement);
    }

    const rows = await tx.$queryRawUnsafe<Array<{ name: string; status: string }>>(
      `SELECT "name", "status"::text AS "status" FROM "contest_entries"`,
    );
    const [{ column_default: defaultStatus }] = await tx.$queryRawUnsafe<Array<{ column_default: string }>>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'contest_entries' AND column_name = 'status'`,
      schema,
    );
    await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    return { statusByName: new Map(rows.map((row) => [row.name, row.status])), defaultStatus };
  });
}

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

describe('#481 migration: an entry is a draft until submitted', () => {
  it('submits every entry on a contest that has started or finished, whatever its lineup, so live and settled results do not change', async () => {
    const { statusByName } = await migrate([
      { name: 'drafting, short', contestStatus: 'DRAFTING', tiered: { picksPerTier: 1, picksByTier: [1] } },
      { name: 'locked, short', contestStatus: 'LOCKED', tiered: { picksPerTier: 1, picksByTier: [1] } },
      { name: 'active, empty', contestStatus: 'ACTIVE', tiered: { picksPerTier: 1, picksByTier: [] } },
      { name: 'completed, complete', contestStatus: 'COMPLETED', tiered: { picksPerTier: 1, picksByTier: [1, 2] } },
      { name: 'cancelled, short budget', contestStatus: 'CANCELLED', budget: { rosterSize: 3, picks: 1 } },
    ]);

    expect(Object.fromEntries(statusByName)).toEqual({
      'drafting, short': 'SUBMITTED',
      'locked, short': 'SUBMITTED',
      'active, empty': 'SUBMITTED',
      'completed, complete': 'SUBMITTED',
      'cancelled, short budget': 'SUBMITTED',
    });
  });

  it('submits an entry on an unstarted contest whose lineup is complete, so members who already finished stay in', async () => {
    const { statusByName } = await migrate([
      { name: 'open, one per tier', contestStatus: 'OPEN', tiered: { picksPerTier: 1, picksByTier: [1, 2] } },
      { name: 'draft, two per tier', contestStatus: 'DRAFT', tiered: { picksPerTier: 2, picksByTier: [1, 2, 1, 2] } },
      { name: 'open, full budget', contestStatus: 'OPEN', budget: { rosterSize: 2, picks: 2 } },
    ]);

    expect(Object.fromEntries(statusByName)).toEqual({
      'open, one per tier': 'SUBMITTED',
      'draft, two per tier': 'SUBMITTED',
      'open, full budget': 'SUBMITTED',
    });
  });

  it('turns an entry on an unstarted contest back into a draft when its lineup is short, misplaced across tiers, or has no picks-per-tier to check against', async () => {
    const { statusByName } = await migrate([
      { name: 'open, short', contestStatus: 'OPEN', tiered: { picksPerTier: 1, picksByTier: [1] } },
      { name: 'open, empty', contestStatus: 'OPEN', tiered: { picksPerTier: 1, picksByTier: [] } },
      { name: 'open, both in tier 1', contestStatus: 'OPEN', tiered: { picksPerTier: 1, picksByTier: [1, 1] } },
      { name: 'draft, golfer in no tier', contestStatus: 'DRAFT', tiered: { picksPerTier: 1, picksByTier: [1, 0] } },
      { name: 'open, no picksPerTier', contestStatus: 'OPEN', tiered: { picksByTier: [1, 2] } },
      { name: 'open, short budget', contestStatus: 'OPEN', budget: { rosterSize: 3, picks: 2 } },
    ]);

    expect(Object.fromEntries(statusByName)).toEqual({
      'open, short': 'DRAFT',
      'open, empty': 'DRAFT',
      'open, both in tier 1': 'DRAFT',
      'draft, golfer in no tier': 'DRAFT',
      'open, no picksPerTier': 'DRAFT',
      'open, short budget': 'DRAFT',
    });
  });

  it('leaves inactive entries inactive and starts new entries as DRAFT', async () => {
    const { statusByName, defaultStatus } = await migrate([
      { name: 'open, inactive', contestStatus: 'OPEN', status: 'INACTIVE', tiered: { picksPerTier: 1, picksByTier: [] } },
      { name: 'completed, inactive', contestStatus: 'COMPLETED', status: 'INACTIVE', tiered: { picksPerTier: 1, picksByTier: [1, 2] } },
    ]);

    expect(Object.fromEntries(statusByName)).toEqual({
      'open, inactive': 'INACTIVE',
      'completed, inactive': 'INACTIVE',
    });
    expect(defaultStatus).toContain("'DRAFT'");
  });
});
