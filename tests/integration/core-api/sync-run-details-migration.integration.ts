/**
 * #1174 — the migration that moves a stored sync run's detailed diagnostics out of its summary
 * payload into their own column, run against real Postgres in a scratch schema.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../../packages/core-api/prisma/migrations/20261230100000_split_sync_run_details/migration.sql'),
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

interface MigratedRun {
  payload: unknown;
  details: unknown;
}

/** Seeds pre-migration run payloads in a scratch schema, runs the migration there, and reads them back. */
async function migrate(payloads: Record<string, unknown>): Promise<Record<string, MigratedRun>> {
  const schema = `mig1174_${randomUUID().replace(/-/g, '')}`;
  return getPrisma().$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
    await tx.$executeRawUnsafe(`CREATE TABLE "provider_sync_runs" (
      "id" varchar(20) PRIMARY KEY,
      "payload_json" jsonb NOT NULL DEFAULT '{}'
    )`);
    for (const [id, payload] of Object.entries(payloads)) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "provider_sync_runs" ("id", "payload_json") VALUES ($1, $2::jsonb)`,
        id,
        JSON.stringify(payload),
      );
    }

    for (const statement of MIGRATION_STATEMENTS) {
      await tx.$executeRawUnsafe(statement);
    }

    const migrated = await tx.$queryRawUnsafe<Array<{ id: string; payload_json: unknown; details_json: unknown }>>(
      `SELECT "id", "payload_json", "details_json" FROM "provider_sync_runs"`,
    );
    await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    return Object.fromEntries(migrated.map((row) => [row.id, { payload: row.payload_json, details: row.details_json }]));
  });
}

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

describe('#1174 migration: sync run details move to their own column', () => {
  it('moves the provider payload, job, write diagnostics and failure into the details and keeps the summary', async () => {
    const summary = {
      runType: 'MANUAL_EVENT_SYNC',
      requestedFeed: 'EVENTPARTICIPANTS',
      outcome: { severity: 'SUCCESS', summary: 'Done.', warnings: [], errors: 0 },
      stats: { writeRows: 2 },
      detail: 'Done.',
    };
    const details = {
      providerPayload: { operation: 'EVENTPARTICIPANTS', rawCaptured: true, rawTruncated: false, raw: [] },
      jobPayload: { jobType: 'EVENT_PARTICIPANTS_SYNC', recordsProcessed: 2, errorLog: [] },
      writeDiagnostics: { summary: { total: 2, unchanged: 2, created: 0, updated: 0, deleted: 0 }, rows: [] },
      failurePayload: { error: { name: 'Error', message: 'boom' } },
    };

    const migrated = await migrate({ completed: { ...summary, ...details } });

    expect(migrated['completed']).toEqual({ payload: summary, details });
  });

  it('moves only the detail keys a run has, and leaves a run with none of them without details', async () => {
    const migrated = await migrate({
      started: { requestedFeed: 'EVENTLIVESCORES', providerPayload: { operation: 'EVENTLIVESCORES', rawCaptured: false } },
      submitted: { requestedFeed: 'EVENTLIVESCORES', detail: 'Submitted.' },
    });

    expect(migrated['started']).toEqual({
      payload: { requestedFeed: 'EVENTLIVESCORES' },
      details: { providerPayload: { operation: 'EVENTLIVESCORES', rawCaptured: false } },
    });
    expect(migrated['submitted']).toEqual({
      payload: { requestedFeed: 'EVENTLIVESCORES', detail: 'Submitted.' },
      details: null,
    });
  });
});
