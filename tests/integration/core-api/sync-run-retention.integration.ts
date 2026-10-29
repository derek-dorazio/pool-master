/**
 * #1174 — the nightly cleanup's sync-run steps against Postgres: a run's detailed diagnostics are
 * cleared 30 days after submission, and the run itself is deleted a year after it.
 */
import { Prisma } from '@prisma/client';
import { ProviderSyncRunStatus, Sport } from '@poolmaster/shared/domain';
import { PrismaProviderSyncRunRepository } from '../../../packages/core-api/src/adapters';
import {
  SyncRunDetailsRetention,
  SyncRunRetention,
} from '../../../packages/core-api/src/modules/ingestion/persistence/sync-run-retention';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const NOW = new Date('2026-10-29T08:00:00.000Z');
const DAY_MS = 24 * 60 * 60_000;
const DETAILS = { jobPayload: { recordsProcessed: 3 } };

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

async function seedRun(label: string, createdAt: Date, details: object | null = DETAILS) {
  const repo = new PrismaProviderSyncRunRepository(getPrisma());
  const run = await repo.create({
    providerId: 'retention-feed',
    sport: Sport.GOLF,
    eventId: label,
    status: ProviderSyncRunStatus.COMPLETED,
    startedAt: null,
    completedAt: null,
    payload: { detail: label },
    createdAt,
  });
  if (details) {
    await repo.update(run.id, { status: ProviderSyncRunStatus.COMPLETED, payload: { detail: label }, details: { ...details } });
  }
  return run.id;
}

async function detailsByLabel(): Promise<Record<string, { details: Prisma.JsonValue; payload: Prisma.JsonValue }>> {
  const rows = await getPrisma().providerSyncRun.findMany({ select: { eventId: true, detailsJson: true, payloadJson: true } });
  const byLabel: Record<string, { details: Prisma.JsonValue; payload: Prisma.JsonValue }> = {};
  for (const row of rows) {
    byLabel[row.eventId ?? ''] = { details: row.detailsJson, payload: row.payloadJson };
  }
  return byLabel;
}

describe('sync-run details retention (#1174)', () => {
  it('clears the details of runs submitted more than 30 days ago and keeps their summary, and keeps newer runs\' details', async () => {
    await seedRun('submitted-31-days-ago', daysAgo(31));
    await seedRun('submitted-36-days-ago', daysAgo(36));
    await seedRun('submitted-29-days-ago', daysAgo(29));

    const cleared = await new SyncRunDetailsRetention(new PrismaProviderSyncRunRepository(getPrisma())).purge(NOW);

    expect(cleared).toBe(2);
    expect(await detailsByLabel()).toEqual({
      'submitted-31-days-ago': { details: null, payload: { detail: 'submitted-31-days-ago' } },
      'submitted-36-days-ago': { details: null, payload: { detail: 'submitted-36-days-ago' } },
      'submitted-29-days-ago': { details: DETAILS, payload: { detail: 'submitted-29-days-ago' } },
    });
  });

  it('looks back one week past the 30 days, leaving older runs to the nights that already passed them', async () => {
    await seedRun('submitted-36-days-ago', daysAgo(36));
    await seedRun('submitted-38-days-ago', daysAgo(38));

    const cleared = await new SyncRunDetailsRetention(new PrismaProviderSyncRunRepository(getPrisma())).purge(NOW);

    expect(cleared).toBe(1);
    expect((await detailsByLabel())['submitted-38-days-ago'].details).toEqual(DETAILS);
  });

  it('counts only the runs it cleared, not ones that had no details left', async () => {
    await seedRun('already-cleared', daysAgo(32), null);
    await seedRun('still-holding-details', daysAgo(32));

    const repo = new PrismaProviderSyncRunRepository(getPrisma());
    expect(await new SyncRunDetailsRetention(repo).purge(NOW)).toBe(1);
    expect(await new SyncRunDetailsRetention(repo).purge(NOW)).toBe(0);
  });

  it('clears in bounded batches until a batch comes back short', async () => {
    for (let index = 0; index < 5; index += 1) {
      await seedRun(`batched-${index}`, daysAgo(31 + index / 10));
    }
    const repo = new PrismaProviderSyncRunRepository(getPrisma());

    expect(await repo.clearDetailsBatchSubmittedBetween(daysAgo(37), daysAgo(30), 2)).toBe(2);
    expect(await repo.clearDetailsBatchSubmittedBetween(daysAgo(37), daysAgo(30), 2)).toBe(2);
    expect(await repo.clearDetailsBatchSubmittedBetween(daysAgo(37), daysAgo(30), 2)).toBe(1);
    expect(await getPrisma().providerSyncRun.count({ where: { detailsJson: { not: Prisma.DbNull } } })).toBe(0);
  });
});

describe('sync-run retention (#1174)', () => {
  it('deletes runs submitted more than a year ago and keeps newer ones', async () => {
    await seedRun('submitted-13-months-ago', new Date('2025-09-29T08:00:00.000Z'), null);
    await seedRun('submitted-a-year-and-a-day-ago', new Date('2025-10-28T08:00:00.000Z'), null);
    await seedRun('submitted-11-months-ago', new Date('2025-11-29T08:00:00.000Z'), null);

    const deleted = await new SyncRunRetention(new PrismaProviderSyncRunRepository(getPrisma())).purge(NOW);

    expect(deleted).toBe(2);
    expect(Object.keys(await detailsByLabel())).toEqual(['submitted-11-months-ago']);
  });
});
