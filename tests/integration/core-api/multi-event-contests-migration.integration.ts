/**
 * #713 — the migration that lets a contest cover several events, run against the rows it exists
 * to copy.
 *
 * The test database is already past the migration, so `contests.sport_event_id` and
 * `contest_entries.status` no longer exist in it. Each case therefore builds the tables the
 * migration reads, alters or references, as they stood before it, in a throwaway schema of its
 * own, seeds them, and runs the real `migration.sql` with that schema first on the search path.
 * Only the columns the migration touches are recreated; the entry status enum is the database's
 * own, which the migration did not change.
 *
 * What is asserted is where each existing row lands: a contest's one event becomes its sequence
 * 1 event, an entry's status becomes its status in that event (a submitted one stamped with its
 * last update), a settled standing is copied as that event's standing, and the old columns go.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../../packages/core-api/prisma/migrations/20261019090000_multi_event_contests/migration.sql'),
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
  `CREATE TABLE "sport_events" ("id" uuid PRIMARY KEY)`,
  `CREATE TABLE "contests" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "sport_event_id" uuid,
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contests_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events" ("id")
  )`,
  `CREATE INDEX "contests_sport_event_id_idx" ON "contests" ("sport_event_id")`,
  `CREATE TABLE "contest_entries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "contest_id" uuid NOT NULL REFERENCES "contests" ("id"),
    "name" text NOT NULL,
    "status" "PrismaContestEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" timestamptz NOT NULL,
    "updated_at" timestamptz NOT NULL
  )`,
  `CREATE TABLE "contest_entry_standings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "contest_id" uuid NOT NULL REFERENCES "contests" ("id"),
    "contest_entry_id" uuid NOT NULL REFERENCES "contest_entries" ("id"),
    "position" integer,
    "display_position" varchar(20),
    "counting_pick_limit" integer NOT NULL,
    "scored_pick_count" integer NOT NULL,
    "total_score" integer,
    "as_of" timestamptz,
    "settled_at" timestamptz NOT NULL,
    "created_at" timestamptz NOT NULL,
    "updated_at" timestamptz NOT NULL
  )`,
];

const CREATED = new Date('2026-03-01T12:00:00.000Z');
const SUBMITTED_AT = new Date('2026-04-08T09:30:00.000Z');
const SETTLED = new Date('2026-04-12T23:00:00.000Z');

interface MigratedRows {
  masters: string;
  contestEvents: Array<{ contest_name: string; sport_event_id: string; sequence: number }>;
  entryEvents: Array<{ entry_name: string; sport_event_id: string; status: string; submitted_at: Date | null }>;
  eventStandings: Array<{
    entry_name: string;
    sport_event_id: string;
    position: number | null;
    display_position: string | null;
    counting_pick_limit: number;
    scored_pick_count: number;
    total_score: number | null;
    as_of: Date | null;
    settled_at: Date;
  }>;
  remainingColumns: Array<{ table_name: string; column_name: string }>;
}

/**
 * Seeds a settled Masters contest with a submitted and a draft entry (the submitted one holding
 * a frozen standing) and an event-less contest with one entry, runs the migration, and reads
 * back what it wrote.
 */
async function migrate(): Promise<MigratedRows> {
  const schema = `mig713_${randomUUID().replace(/-/g, '')}`;
  return getPrisma().$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
    for (const statement of PRE_MIGRATION_TABLES) {
      await tx.$executeRawUnsafe(statement);
    }

    const masters = randomUUID();
    await tx.$executeRawUnsafe(`INSERT INTO "sport_events" ("id") VALUES ($1::uuid)`, masters);
    const [{ id: mastersContest }] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "contests" ("name", "sport_event_id") VALUES ('Masters Pool', $1::uuid) RETURNING "id"`,
      masters,
    );
    const [{ id: eventless }] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "contests" ("name", "sport_event_id") VALUES ('No Event Yet', NULL) RETURNING "id"`,
    );
    const insertEntry = async (contestId: string, name: string, status: 'DRAFT' | 'SUBMITTED', updatedAt: Date) => {
      const [{ id }] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "contest_entries" ("contest_id", "name", "status", "created_at", "updated_at")
         VALUES ($1::uuid, $2, $3::"PrismaContestEntryStatus", $4, $5) RETURNING "id"`,
        contestId, name, status, CREATED, updatedAt,
      );
      return id;
    };
    const submitted = await insertEntry(mastersContest, 'Submitted Entry', 'SUBMITTED', SUBMITTED_AT);
    await insertEntry(mastersContest, 'Draft Entry', 'DRAFT', CREATED);
    const orphan = await insertEntry(eventless, 'Eventless Entry', 'SUBMITTED', SUBMITTED_AT);
    for (const [contestId, entryId] of [[mastersContest, submitted], [eventless, orphan]]) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "contest_entry_standings" ("contest_id", "contest_entry_id", "position", "display_position",
           "counting_pick_limit", "scored_pick_count", "total_score", "as_of", "settled_at", "created_at", "updated_at")
         VALUES ($1::uuid, $2::uuid, 1, 'T1', 4, 3, -11, $3, $4, $4, $4)`,
        contestId, entryId, SUBMITTED_AT, SETTLED,
      );
    }

    for (const statement of MIGRATION_STATEMENTS) {
      await tx.$executeRawUnsafe(statement);
    }

    const contestEvents = await tx.$queryRawUnsafe<MigratedRows['contestEvents']>(
      `SELECT c."name" AS "contest_name", cse."sport_event_id"::text AS "sport_event_id", cse."sequence"
       FROM "contest_sport_events" cse JOIN "contests" c ON c."id" = cse."contest_id" ORDER BY c."name"`,
    );
    const entryEvents = await tx.$queryRawUnsafe<MigratedRows['entryEvents']>(
      `SELECT e."name" AS "entry_name", cee."sport_event_id"::text AS "sport_event_id", cee."status"::text AS "status", cee."submitted_at"
       FROM "contest_entry_events" cee JOIN "contest_entries" e ON e."id" = cee."contest_entry_id" ORDER BY e."name"`,
    );
    const eventStandings = await tx.$queryRawUnsafe<MigratedRows['eventStandings']>(
      `SELECT e."name" AS "entry_name", s."sport_event_id"::text AS "sport_event_id", s."position", s."display_position",
              s."counting_pick_limit", s."scored_pick_count", s."total_score", s."as_of", s."settled_at"
       FROM "contest_entry_event_standings" s JOIN "contest_entries" e ON e."id" = s."contest_entry_id" ORDER BY e."name"`,
    );
    const remainingColumns = await tx.$queryRawUnsafe<MigratedRows['remainingColumns']>(
      `SELECT table_name::text AS "table_name", column_name::text AS "column_name" FROM information_schema.columns
       WHERE table_schema = $1 AND ((table_name = 'contests' AND column_name = 'sport_event_id')
          OR (table_name = 'contest_entries' AND column_name = 'status'))`,
      schema,
    );
    await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    return { masters, contestEvents, entryEvents, eventStandings, remainingColumns };
  });
}

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

describe('#713 migration: a contest covers one or more events', () => {
  it('makes each contest\'s one event its sequence 1 event, and gives a contest that had no event none', async () => {
    const { masters, contestEvents } = await migrate();

    expect(contestEvents).toEqual([{ contest_name: 'Masters Pool', sport_event_id: masters, sequence: 1 }]);
  });

  it('copies each entry\'s status into that event, stamping a submitted entry with its last update and a draft with no submit time', async () => {
    const { masters, entryEvents } = await migrate();

    expect(entryEvents).toEqual([
      { entry_name: 'Draft Entry', sport_event_id: masters, status: 'DRAFT', submitted_at: null },
      { entry_name: 'Submitted Entry', sport_event_id: masters, status: 'SUBMITTED', submitted_at: SUBMITTED_AT },
    ]);
  });

  it('copies a settled standing, every column of it, as that event\'s standing, and nothing for a contest with no event', async () => {
    const { masters, eventStandings } = await migrate();

    expect(eventStandings).toEqual([{
      entry_name: 'Submitted Entry',
      sport_event_id: masters,
      position: 1,
      display_position: 'T1',
      counting_pick_limit: 4,
      scored_pick_count: 3,
      total_score: -11,
      as_of: SUBMITTED_AT,
      settled_at: SETTLED,
    }]);
  });

  it('drops the contest\'s single event column and the entry\'s single status column once they are copied', async () => {
    const { remainingColumns } = await migrate();

    expect(remainingColumns).toEqual([]);
  });
});
