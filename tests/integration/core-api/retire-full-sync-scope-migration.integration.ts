/**
 * #435 — the migration that retires the provider-owned FULL sync scope, run against the rows it
 * exists to rewrite.
 *
 * The test database is already past the migration, so FULL no longer exists in it. Each case
 * therefore builds the two tables the migration touches, as they stood before it, in a
 * throwaway schema of its own, seeds them, and runs the real `migration.sql` with that schema
 * first on the search path. Only the columns the migration reads or writes are recreated.
 *
 * What is asserted is what the deploy does to existing events:
 *   - each FULL event is backfilled to SCORES_ONLY (linked) or NONE (manual-admin placeholder);
 *   - it gets the default round schedule, keeping rounds it already has;
 *   - its automatic lifecycle is turned off. The lifecycle scheduler never moved a FULL event,
 *     and stale ones sit in SCHEDULED or IN_PROGRESS with past dates, so leaving it on would
 *     let the first sweep after deploy activate and settle their contests and email members.
 *   - events that were not FULL are left exactly as they were.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../../packages/core-api/prisma/migrations/20261007140000_retire_full_sync_scope/migration.sql'),
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
  `CREATE TYPE "PrismaSportEventSyncScope" AS ENUM ('NONE', 'SCORES_ONLY', 'FULL')`,
  `CREATE TABLE "sport_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "provider_id" text NOT NULL,
    "status" text NOT NULL,
    "start_date" timestamptz NOT NULL,
    "rounds" integer,
    "auto_lifecycle_enabled" boolean NOT NULL DEFAULT true,
    "sync_scope" "PrismaSportEventSyncScope" NOT NULL DEFAULT 'FULL'
  )`,
  `CREATE TABLE "sport_event_rounds" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "sport_event_id" uuid NOT NULL REFERENCES "sport_events" ("id"),
    "round_number" integer NOT NULL,
    "scheduled_date" timestamptz NOT NULL,
    "updated_at" timestamptz NOT NULL,
    UNIQUE ("sport_event_id", "round_number")
  )`,
];

interface SeedEvent {
  name: string;
  providerId: string;
  status: string;
  rounds: number | null;
  syncScope: 'NONE' | 'SCORES_ONLY' | 'FULL';
  autoLifecycleEnabled?: boolean;
  existingRounds?: number[];
}

interface MigratedEvent {
  name: string;
  status: string;
  sync_scope: string;
  auto_lifecycle_enabled: boolean;
  round_numbers: number[] | null;
}

/** Seeds pre-migration rows in a scratch schema, runs the migration there, and reads the result back. */
async function migrate(events: SeedEvent[]): Promise<Map<string, MigratedEvent>> {
  const schema = `mig435_${randomUUID().replace(/-/g, '')}`;
  return getPrisma().$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
    for (const statement of PRE_MIGRATION_TABLES) {
      await tx.$executeRawUnsafe(statement);
    }
    for (const event of events) {
      const [{ id }] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "sport_events" ("name", "provider_id", "status", "start_date", "rounds", "auto_lifecycle_enabled", "sync_scope")
         VALUES ($1, $2, $3, '2026-08-01T12:00:00Z', $4, $5, $6::"PrismaSportEventSyncScope") RETURNING "id"`,
        event.name, event.providerId, event.status, event.rounds, event.autoLifecycleEnabled ?? true, event.syncScope,
      );
      for (const roundNumber of event.existingRounds ?? []) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "sport_event_rounds" ("sport_event_id", "round_number", "scheduled_date", "updated_at")
           VALUES ($1::uuid, $2, '2026-08-01T08:00:00Z', now())`,
          id, roundNumber,
        );
      }
    }

    for (const statement of MIGRATION_STATEMENTS) {
      await tx.$executeRawUnsafe(statement);
    }

    const rows = await tx.$queryRawUnsafe<MigratedEvent[]>(
      `SELECT e."name", e."status", e."sync_scope"::text AS "sync_scope", e."auto_lifecycle_enabled",
              array_agg(r."round_number" ORDER BY r."round_number") FILTER (WHERE r."round_number" IS NOT NULL) AS "round_numbers"
       FROM "sport_events" e LEFT JOIN "sport_event_rounds" r ON r."sport_event_id" = e."id"
       GROUP BY e."id"`,
    );
    await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    return new Map(rows.map((row) => [row.name, row]));
  });
}

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

describe('#435 migration: retire the FULL sync scope', () => {
  it('turns automatic lifecycle off for every former FULL event, so the first scheduler sweep after deploy cannot activate or settle a stale one', async () => {
    const migrated = await migrate([
      { name: 'stale scheduled', providerId: 'feed', status: 'SCHEDULED', rounds: 4, syncScope: 'FULL' },
      { name: 'stale in progress', providerId: 'feed', status: 'IN_PROGRESS', rounds: 4, syncScope: 'FULL', existingRounds: [1] },
      { name: 'stale no rounds', providerId: 'manual-admin', status: 'SCHEDULED', rounds: null, syncScope: 'FULL' },
    ]);

    expect([...migrated.values()].map((event) => [event.name, event.auto_lifecycle_enabled])).toEqual(
      expect.arrayContaining([
        ['stale scheduled', false],
        ['stale in progress', false],
        ['stale no rounds', false],
      ]),
    );
    // The status is not touched: whatever an admin does next starts from where the event was left.
    expect(migrated.get('stale in progress')?.status).toBe('IN_PROGRESS');
  });

  it('backfills a linked FULL event to SCORES_ONLY and a manual-admin one to NONE, filling in missing default rounds and keeping existing ones', async () => {
    const migrated = await migrate([
      { name: 'linked', providerId: 'feed', status: 'IN_PROGRESS', rounds: 4, syncScope: 'FULL', existingRounds: [1, 5] },
      { name: 'manual', providerId: 'manual-admin', status: 'SCHEDULED', rounds: 4, syncScope: 'FULL' },
      { name: 'no round count', providerId: 'feed', status: 'SCHEDULED', rounds: null, syncScope: 'FULL' },
    ]);

    expect(migrated.get('linked')).toMatchObject({ sync_scope: 'SCORES_ONLY', round_numbers: [1, 2, 3, 4, 5] });
    expect(migrated.get('manual')).toMatchObject({ sync_scope: 'NONE', round_numbers: [1, 2, 3, 4] });
    expect(migrated.get('no round count')).toMatchObject({ sync_scope: 'SCORES_ONLY', round_numbers: null });
  });

  it('leaves events that were not FULL exactly as they were, automatic lifecycle included', async () => {
    const migrated = await migrate([
      { name: 'linked admin event', providerId: 'feed', status: 'SCHEDULED', rounds: 4, syncScope: 'SCORES_ONLY', existingRounds: [1] },
      { name: 'manual admin event', providerId: 'manual-admin', status: 'SCHEDULED', rounds: 4, syncScope: 'NONE', autoLifecycleEnabled: false },
    ]);

    expect(migrated.get('linked admin event')).toMatchObject({ sync_scope: 'SCORES_ONLY', auto_lifecycle_enabled: true, round_numbers: [1] });
    expect(migrated.get('manual admin event')).toMatchObject({ sync_scope: 'NONE', auto_lifecycle_enabled: false, round_numbers: null });
  });
});
