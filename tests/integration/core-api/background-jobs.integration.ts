/**
 * #1440 — the background job table against Postgres: the claim is a row-locking query, the dedupe
 * key a unique index and a job's commit is its caller's transaction's, so each is proved here
 * against the real table rather than a fake.
 */
import { randomUUID } from 'node:crypto';
import { BackgroundJobStatus, BackgroundJobType, Sport } from '@poolmaster/shared/domain';
import {
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import {
  BACKGROUND_JOB_ERROR_MAX_LENGTH,
  PrismaBackgroundJobRepository,
  insertBackgroundJobs,
} from '../../../packages/core-api/src/adapters/prisma-background-job-repository';
import { PrismaProviderSyncRunRepository } from '../../../packages/core-api/src/adapters';
import { jobHandlers } from '../../support/in-memory-background-jobs';
import {
  BackgroundJobQueue,
  BackgroundJobRetention,
  BackgroundJobRunner,
} from '../../../packages/core-api/src/modules/background-jobs';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());
beforeEach(async () => {
  await getPrisma().backgroundJob.deleteMany();
});

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;

function syncPayload(eventId: string) {
  return { syncRunIds: [randomUUID()], sport: Sport.GOLF, eventId };
}

/** A claim time just after the jobs were queued: their run time is the database's clock, not this one's. */
function soonAfterQueued(): Date {
  return new Date(Date.now() + 1000);
}

function repository() {
  return new PrismaBackgroundJobRepository(getAppPrisma());
}

describe('background job table (#1440)', () => {
  it('runs each of many jobs exactly once when two runners drain the table at the same time', async () => {
    const jobs = repository();
    const queue = new BackgroundJobQueue({ jobs });
    const eventIds = Array.from({ length: 8 }, (_, index) => `two-runners-${String(index)}`);
    for (const eventId of eventIds) {
      await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload(eventId));
    }
    const ran: string[] = [];
    const runner = () => new BackgroundJobRunner({
      jobs: repository(),
      handlers: jobHandlers({
        MANUAL_EVENT_SYNC: async (payload) => {
          ran.push(payload.eventId);
          await new Promise((resolve) => { setTimeout(resolve, 5); });
        },
      }),
    });

    await Promise.all([runner().drain(), runner().drain()]);

    expect([...ran].sort()).toEqual([...eventIds].sort());
    const rows = await getPrisma().backgroundJob.findMany();
    expect(rows.every((row) => row.status === BackgroundJobStatus.SUCCEEDED && row.attempts === 1 && row.completedAt !== null)).toBe(true);
  });

  it('claims a running job again only once its lease has ended, counting one more attempt', async () => {
    const jobs = repository();
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('lease') });
    const now = soonAfterQueued();
    const [claimed] = await jobs.claimDue({ now, limit: 5, leaseUntil: new Date(now.getTime() + 5 * MINUTE) });
    expect(claimed).toMatchObject({ status: BackgroundJobStatus.RUNNING, attempts: 1 });

    await expect(jobs.claimDue({ now: new Date(now.getTime() + 5 * MINUTE - 1), limit: 5, leaseUntil: new Date(now.getTime() + 10 * MINUTE) }))
      .resolves.toEqual([]);
    const [reclaimed] = await jobs.claimDue({ now: new Date(now.getTime() + 5 * MINUTE), limit: 5, leaseUntil: new Date(now.getTime() + 10 * MINUTE) });

    expect(reclaimed).toMatchObject({ id: claimed.id, status: BackgroundJobStatus.RUNNING, attempts: 2 });
    expect(reclaimed.leaseUntil).toEqual(new Date(now.getTime() + 10 * MINUTE));
  });

  it('writes no mark from a stale claim once the job was claimed again on a later attempt', async () => {
    const jobs = repository();
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('stale') });
    const now = soonAfterQueued();
    const [stale] = await jobs.claimDue({ now, limit: 1, leaseUntil: new Date(now.getTime() + 5 * MINUTE) });
    const [current] = await jobs.claimDue({ now: new Date(now.getTime() + 5 * MINUTE), limit: 1, leaseUntil: new Date(now.getTime() + 10 * MINUTE) });

    await expect(jobs.markSucceeded(current, now)).resolves.toBe(true);
    await expect(jobs.markRetry(stale, { runAt: now, error: 'late failure' })).resolves.toBe(false);
    await expect(jobs.markFailed(stale, { error: 'late failure', completedAt: now })).resolves.toBe(false);

    const row = await getPrisma().backgroundJob.findUniqueOrThrow({ where: { id: current.id } });
    expect(row).toMatchObject({ status: BackgroundJobStatus.SUCCEEDED, attempts: 2, lastError: null });
  });

  it('lets a new job with the same dedupe key queue while the first waits to be retried', async () => {
    const jobs = repository();
    const request = { type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('retry-key'), dedupeKey: 'MANUAL_EVENT_SYNC:retry-key' };
    await jobs.enqueue(request);
    const now = soonAfterQueued();
    const [claimed] = await jobs.claimDue({ now, limit: 1, leaseUntil: new Date(now.getTime() + 5 * MINUTE) });
    await jobs.markRetry(claimed, { runAt: new Date(now.getTime() + MINUTE), error: 'provider timed out' });

    await expect(jobs.enqueue(request)).resolves.toBe(true);
    await expect(getPrisma().backgroundJob.count({ where: { status: BackgroundJobStatus.QUEUED } })).resolves.toBe(2);
  });

  it('leaves no job behind when the transaction that queued it rolls back', async () => {
    await expect(getAppPrisma().$transaction(async (tx) => {
      await insertBackgroundJobs(tx, [{ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('rolled-back') }]);
      throw new Error('the change that caused the job failed');
    })).rejects.toThrow('the change that caused the job failed');

    await expect(getPrisma().backgroundJob.count()).resolves.toBe(0);
  });

  it('coalesces queued jobs sharing a dedupe key, and queues a fresh one once the first is claimed', async () => {
    const jobs = repository();
    const request = { type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('dedupe'), dedupeKey: 'MANUAL_EVENT_SYNC:dedupe' };

    await expect(jobs.enqueue(request)).resolves.toBe(true);
    await expect(jobs.enqueue(request)).resolves.toBe(false);
    await expect(getPrisma().backgroundJob.count()).resolves.toBe(1);

    const now = soonAfterQueued();
    await jobs.claimDue({ now, limit: 1, leaseUntil: new Date(now.getTime() + 5 * MINUTE) });
    await expect(jobs.enqueue(request)).resolves.toBe(true);

    const rows = await getPrisma().backgroundJob.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((row) => [row.status, row.dedupeKey])).toEqual([
      [BackgroundJobStatus.RUNNING, null],
      [BackgroundJobStatus.QUEUED, 'MANUAL_EVENT_SYNC:dedupe'],
    ]);
  });

  it('records a retry as QUEUED at its new run time and a failure as FAILED, each keeping the error cut to its limit', async () => {
    const jobs = repository();
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('retry') });
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('fail') });
    const now = soonAfterQueued();
    const [retried, failed] = await jobs.claimDue({ now, limit: 2, leaseUntil: new Date(now.getTime() + 5 * MINUTE) });
    const longError = 'x'.repeat(BACKGROUND_JOB_ERROR_MAX_LENGTH + 50);

    await jobs.markRetry(retried, { runAt: new Date(now.getTime() + MINUTE), error: 'provider timed out' });
    await jobs.markFailed(failed, { error: longError, completedAt: now });

    const retriedRow = await getPrisma().backgroundJob.findUniqueOrThrow({ where: { id: retried.id } });
    const failedRow = await getPrisma().backgroundJob.findUniqueOrThrow({ where: { id: failed.id } });
    expect(retriedRow).toMatchObject({ status: BackgroundJobStatus.QUEUED, runAt: new Date(now.getTime() + MINUTE), leaseUntil: null, lastError: 'provider timed out' });
    expect(failedRow).toMatchObject({ status: BackgroundJobStatus.FAILED, completedAt: now, leaseUntil: null });
    expect(failedRow.lastError).toHaveLength(BACKGROUND_JOB_ERROR_MAX_LENGTH);
  });

  it('nightly retention deletes jobs succeeded over 7 days and failed over 30 days ago, keeping newer and unfinished ones', async () => {
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const rows = {
      succeededLongAgo: { status: BackgroundJobStatus.SUCCEEDED, completedAt: ago(8) },
      succeededRecently: { status: BackgroundJobStatus.SUCCEEDED, completedAt: ago(6) },
      failedLongAgo: { status: BackgroundJobStatus.FAILED, completedAt: ago(31) },
      failedLastWeek: { status: BackgroundJobStatus.FAILED, completedAt: ago(8) },
      queuedOld: { status: BackgroundJobStatus.QUEUED, completedAt: null },
    };
    for (const [eventId, row] of Object.entries(rows)) {
      await getPrisma().backgroundJob.create({
        data: { type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload(eventId), createdAt: ago(60), runAt: ago(60), ...row },
      });
    }

    await expect(new BackgroundJobRetention(repository()).purge(now)).resolves.toBe(2);

    const kept = await getPrisma().backgroundJob.findMany({ select: { payload: true } });
    expect(kept.map((row) => (row.payload as { eventId: string }).eventId).sort())
      .toEqual(['failedLastWeek', 'queuedOld', 'succeededRecently']);
  });
});

describe('manual sync runs and their job (#1441)', () => {
  const run = (feed: string) => ({
    providerId: 'integration-background-jobs',
    sport: Sport.GOLF,
    eventId: 'jobs-event',
    status: 'SUBMITTED' as const,
    startedAt: null,
    completedAt: null,
    payload: { requestedFeed: feed },
  });

  afterEach(async () => {
    await getPrisma().providerSyncRun.deleteMany({ where: { providerId: 'integration-background-jobs' } });
  });

  it('writes the runs, in the order given, and the job naming them in one transaction', async () => {
    const queue = new BackgroundJobQueue({ jobs: repository() });

    const runs = await new PrismaProviderSyncRunRepository(getAppPrisma()).createWithJob(
      [run('EVENTPARTICIPANTS'), run('EVENTLIVESCORES')],
      (written) => queue.request(BackgroundJobType.MANUAL_EVENT_SYNC, {
        syncRunIds: written.map((one) => one.id),
        sport: Sport.GOLF,
        eventId: 'jobs-event',
      }),
    );

    expect(runs.map((written) => written.payload['requestedFeed'])).toEqual(['EVENTPARTICIPANTS', 'EVENTLIVESCORES']);
    const job = await getPrisma().backgroundJob.findFirstOrThrow();
    expect(job).toMatchObject({ type: BackgroundJobType.MANUAL_EVENT_SYNC, status: BackgroundJobStatus.QUEUED });
    expect(job.payload).toEqual({ syncRunIds: runs.map((written) => written.id), sport: Sport.GOLF, eventId: 'jobs-event' });
    await expect(new PrismaProviderSyncRunRepository(getAppPrisma()).findManyByIds(runs.map((written) => written.id)))
      .resolves.toHaveLength(2);
  });

  it('writes neither the runs nor a job when the job cannot be built', async () => {
    const queue = new BackgroundJobQueue({ jobs: repository() });

    await expect(new PrismaProviderSyncRunRepository(getAppPrisma()).createWithJob(
      [run('EVENTPARTICIPANTS')],
      () => queue.request(BackgroundJobType.MANUAL_EVENT_SYNC, { syncRunIds: [], sport: Sport.GOLF, eventId: 'jobs-event' }),
    )).rejects.toThrow(/Invalid MANUAL_EVENT_SYNC job payload/);

    await expect(getPrisma().providerSyncRun.count({ where: { providerId: 'integration-background-jobs' } })).resolves.toBe(0);
    await expect(getPrisma().backgroundJob.count()).resolves.toBe(0);
  });
});
