import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

// #1861's migration against real Postgres: a job queued before it reads SYSTEM, with no starter
// and no outcome, and a sync run keeps the trigger it had under the old sync-run-only enum. The
// table is put back as it stood before the migration, a row of each kind is written, the
// migration runs again, and everything is rolled back.

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271211000000_job_trigger_and_outcome/migration.sql');

/** The migration's statements, without its comments. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/** The two tables as they stood before the migration. */
const BEFORE = [
  'DROP INDEX "background_jobs_started_by_user_id_idx"',
  'ALTER TABLE "background_jobs" DROP CONSTRAINT "background_jobs_started_by_user_id_fkey"',
  'ALTER TABLE "background_jobs" DROP COLUMN "trigger", DROP COLUMN "started_by_user_id", DROP COLUMN "started_at", DROP COLUMN "changed_count", DROP COLUMN "error_type"',
  'CREATE TYPE "PrismaProviderSyncTrigger" AS ENUM (\'SCHEDULE\', \'WEBHOOK\', \'ADMIN\')',
  'ALTER TABLE "provider_sync_runs" ALTER COLUMN "trigger" TYPE "PrismaProviderSyncTrigger" USING "trigger"::text::"PrismaProviderSyncTrigger"',
  'DROP TYPE "PrismaJobErrorType"',
  'DROP TYPE "PrismaJobTrigger"',
];

class RolledBack extends Error {}

describe('job trigger migration (#1861)', () => {
  it('reads a job queued before it as SYSTEM with no starter or outcome, and keeps each sync run\'s trigger', async () => {
    const jobId = randomUUID();
    const runId = randomUUID();
    let job: unknown;
    let run: unknown;

    await expect(getPrisma().$transaction(async (tx) => {
      // Only this transaction's rows: it sees no other test's.
      await tx.$executeRawUnsafe('DELETE FROM "provider_sync_runs"');
      await tx.$executeRawUnsafe('DELETE FROM "background_jobs"');
      for (const statement of BEFORE) await tx.$executeRawUnsafe(statement);
      await tx.$executeRawUnsafe(
        'INSERT INTO "background_jobs" ("id", "type", "payload", "status", "run_at", "attempts", "created_at", "completed_at") '
        + 'VALUES ($1::uuid, \'SYNC_LEAGUE_EVENTS\', \'{}\'::jsonb, \'SUCCEEDED\', now(), 1, now(), now())',
        jobId,
      );
      await tx.$executeRawUnsafe(
        'INSERT INTO "provider_sync_runs" ("id", "provider_id", "sport", "kind", "trigger", "status", "background_job_id", "created_at") '
        + 'VALUES ($1::uuid, \'migration-test\', \'GOLF\', \'EVENTS\', \'ADMIN\', \'COMPLETED\', $2::uuid, now())',
        runId,
        jobId,
      );

      for (const statement of migrationStatements()) await tx.$executeRawUnsafe(statement);

      [job] = await tx.$queryRawUnsafe<unknown[]>(
        'SELECT "trigger"::text AS trigger, "started_by_user_id" AS "startedByUserId", "started_at" AS "startedAt", "changed_count" AS "changedCount", "error_type"::text AS "errorType" FROM "background_jobs" WHERE "id" = $1::uuid',
        jobId,
      );
      [run] = await tx.$queryRawUnsafe<unknown[]>('SELECT "trigger"::text AS trigger FROM "provider_sync_runs" WHERE "id" = $1::uuid', runId);
      throw new RolledBack();
    })).rejects.toThrow(RolledBack);

    expect(job).toEqual({ trigger: 'SYSTEM', startedByUserId: null, startedAt: null, changedCount: null, errorType: null });
    expect(run).toEqual({ trigger: 'ADMIN' });
  });
});
