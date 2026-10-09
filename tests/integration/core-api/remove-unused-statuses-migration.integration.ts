/**
 * #531 — the migration that removes the contest statuses DRAFTING, LOCKED and CANCELLED, the entry
 * status INACTIVE, `contest_entries.is_eliminated` and `leagues.join_policy`, run against rows that
 * still hold them.
 *
 * The app never wrote any of these, so no real row should hold one, but the migration must not
 * fail on a row a test or a hand edit left behind. The test database is already past the
 * migration, so each case builds the tables it touches, as they stood before it, in a throwaway
 * schema of its own, seeds them, and runs the real `migration.sql` with that schema first on the
 * search path. Only the columns the migration touches are recreated.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    '../../../packages/core-api/prisma/migrations/20261009010000_remove_unused_contest_entry_statuses_and_join_policy/migration.sql',
  ),
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
  `CREATE TYPE "PrismaContestStatus" AS ENUM ('DRAFT', 'OPEN', 'DRAFTING', 'LOCKED', 'ACTIVE', 'COMPLETED', 'CANCELLED')`,
  `CREATE TYPE "PrismaContestEntryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'INACTIVE')`,
  `CREATE TYPE "PrismaLeagueJoinPolicy" AS ENUM ('COMMISSIONER_ONLY', 'LINK_INVITE', 'OPEN')`,
  `CREATE TABLE "leagues" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "join_policy" "PrismaLeagueJoinPolicy" NOT NULL DEFAULT 'COMMISSIONER_ONLY'
  )`,
  `CREATE TABLE "contests" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "status" "PrismaContestStatus" NOT NULL DEFAULT 'DRAFT'
  )`,
  `CREATE TABLE "contest_entries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "contest_id" uuid NOT NULL REFERENCES "contests" ("id"),
    "name" text NOT NULL,
    "status" "PrismaContestEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "is_eliminated" boolean NOT NULL DEFAULT false
  )`,
];

const OLD_CONTEST_STATUSES = ['DRAFT', 'OPEN', 'DRAFTING', 'LOCKED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
const OLD_ENTRY_STATUSES = ['DRAFT', 'SUBMITTED', 'INACTIVE'] as const;

interface MigrationResult {
  contestStatusByName: Record<string, string>;
  entryStatusByName: Record<string, string>;
  contestStatusValues: string[];
  entryStatusValues: string[];
  columns: string[];
  joinPolicyTypeCount: number;
  defaults: Record<string, string>;
}

/** Seeds one contest per old status and one entry per old entry status, runs the migration, and reads the result back. */
async function migrate(): Promise<MigrationResult> {
  const schema = `mig531_${randomUUID().replace(/-/g, '')}`;
  return getPrisma().$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
    for (const statement of PRE_MIGRATION_TABLES) {
      await tx.$executeRawUnsafe(statement);
    }

    await tx.$executeRawUnsafe(`INSERT INTO "leagues" ("name", "join_policy") VALUES ('Open league', 'OPEN')`);
    let entryHost = '';
    for (const status of OLD_CONTEST_STATUSES) {
      const [{ id }] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "contests" ("name", "status") VALUES ($1, $1::"PrismaContestStatus") RETURNING "id"`,
        status,
      );
      entryHost ||= id;
    }
    for (const status of OLD_ENTRY_STATUSES) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "contest_entries" ("contest_id", "name", "status", "is_eliminated")
         VALUES ($1::uuid, $2, $2::"PrismaContestEntryStatus", true)`,
        entryHost, status,
      );
    }

    for (const statement of MIGRATION_STATEMENTS) {
      await tx.$executeRawUnsafe(statement);
    }

    const contests = await tx.$queryRawUnsafe<Array<{ name: string; status: string }>>(
      `SELECT "name", "status"::text AS "status" FROM "contests"`,
    );
    const entries = await tx.$queryRawUnsafe<Array<{ name: string; status: string }>>(
      `SELECT "name", "status"::text AS "status" FROM "contest_entries"`,
    );
    const enumValues = async (typeName: string) => (await tx.$queryRawUnsafe<Array<{ value: string }>>(
      `SELECT e.enumlabel AS "value" FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = $1 AND t.typname = $2
       ORDER BY e.enumsortorder`,
      schema, typeName,
    )).map((row) => row.value);
    const columnRows = await tx.$queryRawUnsafe<Array<{ table_name: string; column_name: string; column_default: string | null }>>(
      `SELECT table_name, column_name, column_default FROM information_schema.columns
       WHERE table_schema = $1 ORDER BY table_name, ordinal_position`,
      schema,
    );
    const [{ count }] = await tx.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS "count" FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = $1 AND t.typname = 'PrismaLeagueJoinPolicy'`,
      schema,
    );

    const result: MigrationResult = {
      contestStatusByName: Object.fromEntries(contests.map((row) => [row.name, row.status])),
      entryStatusByName: Object.fromEntries(entries.map((row) => [row.name, row.status])),
      contestStatusValues: await enumValues('PrismaContestStatus'),
      entryStatusValues: await enumValues('PrismaContestEntryStatus'),
      columns: columnRows.map((row) => `${row.table_name}.${row.column_name}`),
      joinPolicyTypeCount: count,
      defaults: Object.fromEntries(columnRows
        .filter((row) => row.column_name === 'status')
        .map((row) => [row.table_name, row.column_default ?? ''])),
    };
    await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    return result;
  });
}

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

describe('#531 migration: unused statuses and columns are removed', () => {
  it('leaves only DRAFT, OPEN, ACTIVE and COMPLETED, moving a leftover DRAFTING or LOCKED contest to OPEN and a CANCELLED one to COMPLETED', async () => {
    const result = await migrate();

    expect(result.contestStatusValues).toEqual(['DRAFT', 'OPEN', 'ACTIVE', 'COMPLETED']);
    expect(result.contestStatusByName).toEqual({
      DRAFT: 'DRAFT',
      OPEN: 'OPEN',
      DRAFTING: 'OPEN',
      LOCKED: 'OPEN',
      ACTIVE: 'ACTIVE',
      COMPLETED: 'COMPLETED',
      CANCELLED: 'COMPLETED',
    });
    expect(result.defaults.contests).toBe(`'DRAFT'::"PrismaContestStatus"`);
  });

  it('leaves only DRAFT and SUBMITTED entries, moving a leftover INACTIVE entry to DRAFT so it still counts nowhere', async () => {
    const result = await migrate();

    expect(result.entryStatusValues).toEqual(['DRAFT', 'SUBMITTED']);
    expect(result.entryStatusByName).toEqual({ DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED', INACTIVE: 'DRAFT' });
    expect(result.defaults.contest_entries).toBe(`'DRAFT'::"PrismaContestEntryStatus"`);
  });

  it('drops the entry elimination flag, the league join policy and its type', async () => {
    const result = await migrate();

    expect(result.columns).not.toContain('contest_entries.is_eliminated');
    expect(result.columns).not.toContain('leagues.join_policy');
    expect(result.joinPolicyTypeCount).toBe(0);
  });
});
