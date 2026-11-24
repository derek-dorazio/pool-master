/**
 * #1174 — the nightly cleanup's sync-run steps against Postgres: a run's detailed diagnostics are
 * cleared 30 days after submission, and the run itself is deleted a year after it.
 */
import { syncRunOutcome } from '../../support/sync-run-payload';
import { SCHEDULED_SCORES_RUN } from '../../support/sync-run-fixtures';
import { Prisma } from '@prisma/client';
import { ProviderCode, ProviderSyncRunStatus, Sport } from '@poolmaster/shared/domain';
import { PrismaProviderSyncRunRepository } from '../../../packages/core-api/src/adapters';
import {
  SyncRunDetailsRetention,
  SyncRunRetention,
} from '../../../packages/core-api/src/modules/ingestion/persistence/sync-run-retention';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

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
  const repo = new PrismaProviderSyncRunRepository(getAppPrisma());
  const run = await repo.create({
    ...SCHEDULED_SCORES_RUN,
    providerCode: ProviderCode.BALLDONTLIE,
    sport: Sport.GOLF,
    status: ProviderSyncRunStatus.COMPLETED,
    startedAt: null,
    completedAt: null,
    ...syncRunOutcome({ summary: label }),
    createdAt,
  });
  if (details) {
    await repo.update(run.id, { status: ProviderSyncRunStatus.COMPLETED, ...syncRunOutcome({ summary: label }), details: { ...details } });
  }
  return run.id;
}

async function detailsByLabel(): Promise<Record<string, { details: Prisma.JsonValue }>> {
  const rows = await getPrisma().providerSyncRun.findMany({ select: { detailsJson: true, summary: true } });
  const byLabel: Record<string, { details: Prisma.JsonValue }> = {};
  // A run's label is its summary, which retention keeps.
  for (const row of rows) byLabel[row.summary] = { details: row.detailsJson };
  return byLabel;
}

describe('sync-run details retention (#1174)', () => {
  it('clears the details of runs submitted more than 30 days ago and keeps their summary, and keeps newer runs\' details', async () => {
    await seedRun('submitted-31-days-ago', daysAgo(31));
    await seedRun('submitted-36-days-ago', daysAgo(36));
    await seedRun('submitted-29-days-ago', daysAgo(29));

    const cleared = await new SyncRunDetailsRetention(new PrismaProviderSyncRunRepository(getAppPrisma())).purge(NOW);

    expect(cleared).toBe(2);
    expect(await detailsByLabel()).toEqual({
      'submitted-31-days-ago': { details: null },
      'submitted-36-days-ago': { details: null },
      'submitted-29-days-ago': { details: DETAILS },
    });
  });

  it('still clears runs long past 30 days, so a missed night or a backfilled run is not left holding details', async () => {
    await seedRun('submitted-60-days-ago', daysAgo(60));

    const cleared = await new SyncRunDetailsRetention(new PrismaProviderSyncRunRepository(getAppPrisma())).purge(NOW);

    expect(cleared).toBe(1);
    expect(await detailsByLabel()).toEqual({
      'submitted-60-days-ago': { details: null },
    });
  });

  it('counts only the runs it cleared, not ones that had no details left', async () => {
    await seedRun('already-cleared', daysAgo(32), null);
    await seedRun('still-holding-details', daysAgo(32));

    const repo = new PrismaProviderSyncRunRepository(getAppPrisma());
    expect(await new SyncRunDetailsRetention(repo).purge(NOW)).toBe(1);
    expect(await new SyncRunDetailsRetention(repo).purge(NOW)).toBe(0);
  });

  it('clears in bounded batches until a batch comes back short', async () => {
    for (let index = 0; index < 5; index += 1) {
      await seedRun(`batched-${index}`, daysAgo(31 + index / 10));
    }
    const repo = new PrismaProviderSyncRunRepository(getAppPrisma());

    expect(await repo.clearDetailsBatchSubmittedBefore(daysAgo(30), 2)).toBe(2);
    expect(await repo.clearDetailsBatchSubmittedBefore(daysAgo(30), 2)).toBe(2);
    expect(await repo.clearDetailsBatchSubmittedBefore(daysAgo(30), 2)).toBe(1);
    expect(await getPrisma().providerSyncRun.count({ where: { detailsJson: { not: Prisma.DbNull } } })).toBe(0);
  });
});

describe('sync-run retention (#1174)', () => {
  it('deletes runs submitted more than a year ago and keeps newer ones', async () => {
    await seedRun('submitted-13-months-ago', new Date('2025-09-29T08:00:00.000Z'), null);
    await seedRun('submitted-a-year-and-a-day-ago', new Date('2025-10-28T08:00:00.000Z'), null);
    await seedRun('submitted-11-months-ago', new Date('2025-11-29T08:00:00.000Z'), null);

    const deleted = await new SyncRunRetention(new PrismaProviderSyncRunRepository(getAppPrisma())).purge(NOW);

    expect(deleted).toBe(2);
    expect(Object.keys(await detailsByLabel())).toEqual(['submitted-11-months-ago']);
  });
});

describe('PrismaProviderSyncRunRepository.countFinishedByProvider (#1999)', () => {
  it('counts each Provider\'s runs submitted since the time that finished, and how many failed, leaving out older and unfinished runs', async () => {
    const repo = new PrismaProviderSyncRunRepository(getAppPrisma());
    const write = (status: ProviderSyncRunStatus, createdAt: Date) => repo.create({
      ...SCHEDULED_SCORES_RUN, providerCode: ProviderCode.BALLDONTLIE, sport: Sport.GOLF, status,
      startedAt: null, completedAt: null, ...syncRunOutcome(), createdAt,
    });
    const since = new Date(NOW.getTime() - 60 * 60_000);
    await write(ProviderSyncRunStatus.COMPLETED, new Date(since.getTime() + 60_000));
    await write(ProviderSyncRunStatus.FAILED, new Date(since.getTime() + 120_000));
    await write(ProviderSyncRunStatus.COMPLETED, new Date(since.getTime() + 180_000));
    await write(ProviderSyncRunStatus.IN_PROGRESS, new Date(since.getTime() + 240_000));
    await write(ProviderSyncRunStatus.FAILED, daysAgo(1));
    const provider = await getPrisma().provider.findUniqueOrThrow({ where: { code: ProviderCode.BALLDONTLIE }, select: { id: true } });

    await expect(repo.countFinishedByProvider(since)).resolves.toEqual([{ providerId: provider.id, finished: 3, failed: 1 }]);
    await expect(repo.countFinishedByProvider(NOW)).resolves.toEqual([]);
  });
});
