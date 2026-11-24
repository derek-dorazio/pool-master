/**
 * #1440 — the background job table against Postgres: the claim is a row-locking query, the dedupe
 * key a unique index and a job's commit is its caller's transaction's, so each is proved here
 * against the real table rather than a fake.
 */
import { SCHEDULED_SCORES_RUN } from '../../support/sync-run-fixtures';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { BackgroundJobStatus, BackgroundJobType, JobErrorType, JobTrigger, ProviderCode, ReleaseAttemptOutcome, ReleaseCheckKey, Sport, type ReleaseAttemptResult, type ReleaseCheck } from '@poolmaster/shared/domain';
import { releaseSportEventJob, releaseSportEventJobHandler } from '../../../packages/core-api/src/modules/events/release-sport-event-job';
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
import { jobHandlers, TEST_JOB_START, testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { expectDefined } from '../../support/expect-defined';
import {
  BackgroundJobQueue,
  BackgroundJobRetention,
  BackgroundJobRunner,
} from '../../../packages/core-api/src/modules/background-jobs';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { sportRowKeys } from '../../support/sport-rows';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());
beforeEach(async () => {
  await getPrisma().backgroundJob.deleteMany();
});

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;

function syncPayload(eventId: string) {
  return { syncRunIds: [randomUUID()], sport: Sport.GOLF, providerId: 'integration-background-jobs', eventId };
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
    const queue = new BackgroundJobQueue({ jobs, currentStart: testCurrentJobStart });
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
          return { changedCount: 1 };
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
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('lease'), start: TEST_JOB_START });
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
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('stale'), start: TEST_JOB_START });
    const now = soonAfterQueued();
    const [stale] = await jobs.claimDue({ now, limit: 1, leaseUntil: new Date(now.getTime() + 5 * MINUTE) });
    const [current] = await jobs.claimDue({ now: new Date(now.getTime() + 5 * MINUTE), limit: 1, leaseUntil: new Date(now.getTime() + 10 * MINUTE) });

    await expect(jobs.markSucceeded(current, now, { changedCount: 0 })).resolves.toBe(true);
    await expect(jobs.markRetry(stale, { runAt: now, error: 'late failure', errorType: JobErrorType.OTHER })).resolves.toBe(false);
    await expect(jobs.markFailed(stale, { error: 'late failure', errorType: JobErrorType.OTHER, completedAt: now })).resolves.toBe(false);

    const row = await getPrisma().backgroundJob.findUniqueOrThrow({ where: { id: current.id } });
    expect(row).toMatchObject({ status: BackgroundJobStatus.SUCCEEDED, attempts: 2, lastError: null });
  });

  it('queues a deferred try again for its time with the attempt handed back, and a stale claim cannot defer it', async () => {
    const jobs = repository();
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('deferred'), start: TEST_JOB_START });
    const now = soonAfterQueued();
    const [claimed] = await jobs.claimDue({ now, limit: 1, leaseUntil: new Date(now.getTime() + 5 * MINUTE) });
    const deferUntil = new Date(now.getTime() + 2 * MINUTE);

    await expect(jobs.markDeferred(claimed, { runAt: deferUntil, error: 'provider is rate limiting', errorType: JobErrorType.RATE_LIMITED })).resolves.toBe(true);
    await expect(jobs.markDeferred(claimed, { runAt: deferUntil, error: 'again', errorType: JobErrorType.RATE_LIMITED })).resolves.toBe(false);

    const row = await getPrisma().backgroundJob.findUniqueOrThrow({ where: { id: claimed.id } });
    expect(row).toMatchObject({
      status: BackgroundJobStatus.QUEUED,
      attempts: 0,
      runAt: deferUntil,
      leaseUntil: null,
      lastError: 'provider is rate limiting',
      errorType: JobErrorType.RATE_LIMITED,
    });
  });

  it('lets a new job with the same dedupe key queue while the first waits to be retried', async () => {
    const jobs = repository();
    const request = { type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('retry-key'), dedupeKey: 'MANUAL_EVENT_SYNC:retry-key', start: TEST_JOB_START };
    await jobs.enqueue(request);
    const now = soonAfterQueued();
    const [claimed] = await jobs.claimDue({ now, limit: 1, leaseUntil: new Date(now.getTime() + 5 * MINUTE) });
    await jobs.markRetry(claimed, { runAt: new Date(now.getTime() + MINUTE), error: 'provider timed out', errorType: JobErrorType.TIMEOUT });

    await expect(jobs.enqueue(request)).resolves.toBe(true);
    await expect(getPrisma().backgroundJob.count({ where: { status: BackgroundJobStatus.QUEUED } })).resolves.toBe(2);
  });

  it('leaves no job behind when the transaction that queued it rolls back', async () => {
    await expect(getAppPrisma().$transaction(async (tx) => {
      await insertBackgroundJobs(tx, [{ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('rolled-back'), start: TEST_JOB_START }]);
      throw new Error('the change that caused the job failed');
    })).rejects.toThrow('the change that caused the job failed');

    await expect(getPrisma().backgroundJob.count()).resolves.toBe(0);
  });

  it('coalesces queued jobs sharing a dedupe key, and queues a fresh one once the first is claimed', async () => {
    const jobs = repository();
    const request = { type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('dedupe'), dedupeKey: 'MANUAL_EVENT_SYNC:dedupe', start: TEST_JOB_START };

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

  it('records a retry as QUEUED at its new run time and a failure as FAILED, each keeping its error type and the error cut to its limit, with no changed count', async () => {
    const jobs = repository();
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('retry'), start: TEST_JOB_START });
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('fail'), start: TEST_JOB_START });
    const now = soonAfterQueued();
    const [retried, failed] = await jobs.claimDue({ now, limit: 2, leaseUntil: new Date(now.getTime() + 5 * MINUTE) });
    const longError = 'x'.repeat(BACKGROUND_JOB_ERROR_MAX_LENGTH + 50);

    await jobs.markRetry(retried, { runAt: new Date(now.getTime() + MINUTE), error: 'provider timed out', errorType: JobErrorType.TIMEOUT });
    await jobs.markFailed(failed, { error: longError, errorType: JobErrorType.PROVIDER_ERROR, completedAt: now });

    const retriedRow = await getPrisma().backgroundJob.findUniqueOrThrow({ where: { id: retried.id } });
    const failedRow = await getPrisma().backgroundJob.findUniqueOrThrow({ where: { id: failed.id } });
    expect(retriedRow).toMatchObject({ status: BackgroundJobStatus.QUEUED, runAt: new Date(now.getTime() + MINUTE), leaseUntil: null, lastError: 'provider timed out', errorType: JobErrorType.TIMEOUT, changedCount: null });
    expect(failedRow).toMatchObject({ status: BackgroundJobStatus.FAILED, completedAt: now, leaseUntil: null, errorType: JobErrorType.PROVIDER_ERROR, changedCount: null });
    expect(failedRow.lastError).toHaveLength(BACKGROUND_JOB_ERROR_MAX_LENGTH);
  });

  it('counts the jobs whose latest try hit an error type since a time, failed or waiting to retry, grouped by scope, leaving out older, succeeded and other-error jobs (#1881)', async () => {
    const now = new Date();
    const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * MINUTE);
    const later = new Date(now.getTime() + DAY_MS);
    const leagueId = randomUUID();
    const eventId = randomUUID();
    const rows = [
      { scope: { sportLeagueId: leagueId }, status: BackgroundJobStatus.FAILED, errorType: JobErrorType.RATE_LIMITED, completedAt: hoursAgo(2) },
      { scope: { sportLeagueId: leagueId }, status: BackgroundJobStatus.QUEUED, errorType: JobErrorType.RATE_LIMITED, startedAt: hoursAgo(1) },
      { scope: { sportEventId: eventId }, status: BackgroundJobStatus.FAILED, errorType: JobErrorType.RATE_LIMITED, completedAt: hoursAgo(3) },
      { scope: {}, status: BackgroundJobStatus.FAILED, errorType: JobErrorType.RATE_LIMITED, completedAt: hoursAgo(4) },
      // Left out: failed before the window, retried before it, a different error, and finished fine.
      { scope: { sportLeagueId: leagueId }, status: BackgroundJobStatus.FAILED, errorType: JobErrorType.RATE_LIMITED, completedAt: hoursAgo(25) },
      { scope: { sportEventId: eventId }, status: BackgroundJobStatus.QUEUED, errorType: JobErrorType.RATE_LIMITED, startedAt: hoursAgo(26) },
      { scope: { sportEventId: eventId }, status: BackgroundJobStatus.FAILED, errorType: JobErrorType.TIMEOUT, completedAt: hoursAgo(1) },
      { scope: { sportLeagueId: leagueId }, status: BackgroundJobStatus.SUCCEEDED, errorType: null, startedAt: hoursAgo(1), completedAt: hoursAgo(1) },
    ];
    for (const [index, { scope, ...row }] of rows.entries()) {
      await getPrisma().backgroundJob.create({
        data: { type: BackgroundJobType.MANUAL_EVENT_SYNC, trigger: JobTrigger.SYSTEM, payload: syncPayload(String(index)), runAt: later, ...scope, ...row },
      });
    }

    const counts = await repository().countByScope({ errorType: JobErrorType.RATE_LIMITED, since: hoursAgo(24) });

    const byScope = (count: { sportLeagueId: string | null; sportEventId: string | null }) => `${count.sportLeagueId ?? '-'}/${count.sportEventId ?? '-'}`;
    expect([...counts].sort((a, b) => byScope(a).localeCompare(byScope(b)))).toEqual([
      { sportLeagueId: null, sportEventId: null, count: 1 },
      { sportLeagueId: null, sportEventId: eventId, count: 1 },
      { sportLeagueId: leagueId, sportEventId: null, count: 2 },
    ].sort((a, b) => byScope(a).localeCompare(byScope(b))));
  });

  it('nightly retention deletes every job finished over 30 days ago, succeeded or failed, keeping newer and unfinished ones (#1819)', async () => {
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const rows = {
      succeededLongAgo: { status: BackgroundJobStatus.SUCCEEDED, completedAt: ago(31) },
      succeededRecently: { status: BackgroundJobStatus.SUCCEEDED, completedAt: ago(8) },
      failedLongAgo: { status: BackgroundJobStatus.FAILED, completedAt: ago(31) },
      failedLastWeek: { status: BackgroundJobStatus.FAILED, completedAt: ago(8) },
      queuedOld: { status: BackgroundJobStatus.QUEUED, completedAt: null },
    };
    for (const [eventId, row] of Object.entries(rows)) {
      await getPrisma().backgroundJob.create({
        data: { type: BackgroundJobType.MANUAL_EVENT_SYNC, trigger: JobTrigger.SYSTEM, payload: syncPayload(eventId), createdAt: ago(60), runAt: ago(60), ...row },
      });
    }

    await expect(new BackgroundJobRetention(repository()).purge(now)).resolves.toBe(2);

    const kept = await getPrisma().backgroundJob.findMany({ select: { payload: true } });
    expect(kept.map((row) => (row.payload as { eventId: string }).eventId).sort())
      .toEqual(['failedLastWeek', 'queuedOld', 'succeededRecently']);
  });

  it('keeps one Activity row for each change in an event\'s release hold: three sweeps holding it for the same checks leave one row, a changed hold a second, the release a third (#1865)', async () => {
    const tiersMissing: ReleaseCheck = { key: ReleaseCheckKey.TIERS_ASSIGNED, passed: false, value: 3 };
    const setupsOff: ReleaseCheck = { key: ReleaseCheckKey.CONTEST_SETUPS_ON, passed: false, value: 0 };
    const held = (sameHoldAsBefore: boolean, failing: ReleaseCheck): ReleaseAttemptResult => ({ outcome: ReleaseAttemptOutcome.HELD, checks: [failing], sameHoldAsBefore });
    const attempts: ReleaseAttemptResult[] = [
      held(false, tiersMissing),
      held(true, tiersMissing),
      held(true, tiersMissing),
      held(false, setupsOff),
      { outcome: ReleaseAttemptOutcome.RELEASED, checks: [] },
    ];
    const heldEventId = randomUUID();
    const jobs = repository();
    const queue = new BackgroundJobQueue({ jobs, currentStart: testCurrentJobStart });
    const runner = new BackgroundJobRunner({
      jobs,
      handlers: jobHandlers({ RELEASE_SPORT_EVENT: releaseSportEventJobHandler({ autoReleaseEvent: async () => expectDefined(attempts.shift()) }) }),
    });

    for (let sweep = 0; sweep < 5; sweep += 1) {
      await queue.enqueueAll([releaseSportEventJob(queue, heldEventId)]);
      await runner.drain();
    }

    const rows = await getPrisma().backgroundJob.findMany({ orderBy: { createdAt: 'asc' }, select: { status: true, result: true } });
    expect(rows.map((row) => [row.status, (row.result as { outcome: string }).outcome])).toEqual([
      [BackgroundJobStatus.SUCCEEDED, ReleaseAttemptOutcome.HELD],
      [BackgroundJobStatus.SUCCEEDED, ReleaseAttemptOutcome.HELD],
      [BackgroundJobStatus.SUCCEEDED, ReleaseAttemptOutcome.RELEASED],
    ]);
  });

  it('deletes a discarded job only under its current claim, leaving it in place for a claim lost to a later attempt', async () => {
    const jobs = repository();
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('lost-discard'), start: TEST_JOB_START });
    const now = soonAfterQueued();
    const [stale] = await jobs.claimDue({ now, limit: 1, leaseUntil: new Date(now.getTime() + 5 * MINUTE) });
    const [current] = await jobs.claimDue({ now: new Date(now.getTime() + 5 * MINUTE), limit: 1, leaseUntil: new Date(now.getTime() + 10 * MINUTE) });

    await expect(jobs.deleteClaimed(expectDefined(stale))).resolves.toBe(false);
    await expect(getPrisma().backgroundJob.count()).resolves.toBe(1);
    await expect(jobs.deleteClaimed(expectDefined(current))).resolves.toBe(true);
    await expect(getPrisma().backgroundJob.count()).resolves.toBe(0);
  });
});

describe('Activity reads and job results (#1819)', () => {
  const HOUR = 60 * MINUTE;

  async function leagueWithEvent() {
    const prisma = getPrisma();
    const suffix = randomUUID().slice(0, 8);
    const sport = await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF), participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    const sportLeague = await prisma.sportLeague.create({ data: { ...(await sportLeagueRowDefaults(prisma)), sportId: sport.id, name: `Activity Jobs ${suffix}` } });
    const series = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `Activity Jobs Open ${suffix}` } });
    const event = await prisma.sportEvent.create({
      data: {
        eventSeriesId: series.id, eventYear: 2026, name: `Activity Jobs Open ${suffix}`,
        providerId: 'integration-background-jobs', externalId: `activity-${suffix}`, startDate: new Date(),
      },
    });
    return { sportLeague, event };
  }

  afterEach(async () => {
    const prisma = getPrisma();
    // Runs name a Provider row now (#2040), so this suite's runs are told apart by nothing but being here.
    await prisma.providerSyncRun.deleteMany();
    const leagues = await prisma.sportLeague.findMany({ where: { name: { startsWith: 'Activity Jobs ' } }, select: { id: true } });
    const leagueIds = leagues.map((league) => league.id);
    await prisma.sportEvent.deleteMany({ where: { eventSeries: { sportLeagueId: { in: leagueIds } } } });
    await prisma.eventSeries.deleteMany({ where: { sportLeagueId: { in: leagueIds } } });
    await prisma.sportLeague.deleteMany({ where: { id: { in: leagueIds } } });
  });

  it('writes each job\'s scope to its own columns when it is queued, alone or in a batch', async () => {
    const { sportLeague, event } = await leagueWithEvent();
    const queue = new BackgroundJobQueue({ jobs: repository(), currentStart: testCurrentJobStart });

    await queue.enqueue(BackgroundJobType.SYNC_LEAGUE_EVENTS, { sportLeagueId: sportLeague.id, eventYears: [2026] });
    await queue.enqueueAll([queue.request(BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS, { sportEventId: event.id, completedAt: new Date().toISOString() })]);

    const rows = await getPrisma().backgroundJob.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((row) => [row.type, row.sportLeagueId, row.sportEventId])).toEqual([
      [BackgroundJobType.SYNC_LEAGUE_EVENTS, sportLeague.id, null],
      [BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS, null, event.id],
    ]);
  });

  it('answers the job it queued, and the waiting job when its dedupe key is held', async () => {
    const jobs = repository();
    const request = { type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('returning'), dedupeKey: 'returning-key', start: TEST_JOB_START };

    const first = await jobs.enqueueReturning(request);
    const second = await jobs.enqueueReturning(request);

    expect(second.id).toBe(first.id);
    await expect(getPrisma().backgroundJob.count()).resolves.toBe(1);
  });

  it('writes the request\'s own job when a worker claims the waiting one between the skipped insert and its read', async () => {
    const plain = repository();
    const request = { type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('raced'), dedupeKey: 'raced-key', start: TEST_JOB_START };
    const waiting = await plain.enqueueReturning(request);
    let claimedBetween = false;
    // A client whose first skipped insert is followed by a worker's claim, which frees the key.
    const racing = getAppPrisma().$extends({
      query: {
        backgroundJob: {
          async createManyAndReturn({ args, query }) {
            const written = await query(args);
            if (written.length === 0 && !claimedBetween) {
              claimedBetween = true;
              await plain.claimDue({ now: soonAfterQueued(), limit: 1, leaseUntil: new Date(Date.now() + MINUTE) });
            }
            return written;
          },
        },
      },
    });

    const job = await new PrismaBackgroundJobRepository(racing as unknown as PrismaClient).enqueueReturning(request);

    expect(claimedBetween).toBe(true);
    expect(job.id).not.toBe(waiting.id);
    expect(job.status).toBe(BackgroundJobStatus.QUEUED);
    await expect(getPrisma().backgroundJob.count()).resolves.toBe(2);
  });

  it('keeps a succeeded job\'s changed count and reported result, with no error type', async () => {
    const jobs = repository();
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload('result'), start: TEST_JOB_START });
    const [claimed] = await jobs.claimDue({ now: soonAfterQueued(), limit: 1, leaseUntil: new Date(Date.now() + MINUTE) });

    await expect(jobs.markSucceeded(expectDefined(claimed), new Date(), { changedCount: 3, result: { created: 3 } })).resolves.toBe(true);

    await expect(getPrisma().backgroundJob.findFirstOrThrow())
      .resolves.toMatchObject({ status: BackgroundJobStatus.SUCCEEDED, changedCount: 3, errorType: null, result: { created: 3 } });
  });

  it('lists a league\'s own jobs and its events\' jobs, newest first, inside the window, narrowed by type and status', async () => {
    const { sportLeague, event } = await leagueWithEvent();
    const other = await leagueWithEvent();
    const now = Date.now();
    const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR);
    const prisma = getPrisma();
    const leagueSync = await prisma.backgroundJob.create({ data: { type: 'SYNC_LEAGUE_EVENTS', trigger: JobTrigger.SYSTEM, payload: {}, sportLeagueId: sportLeague.id, createdAt: at(1), status: 'SUCCEEDED', completedAt: at(1) } });
    const eventSettle = await prisma.backgroundJob.create({ data: { type: 'SETTLE_SPORT_EVENT_CONTESTS', trigger: JobTrigger.SYSTEM, payload: {}, sportEventId: event.id, createdAt: at(2) } });
    const oldEventSettle = await prisma.backgroundJob.create({ data: { type: 'SETTLE_SPORT_EVENT_CONTESTS', trigger: JobTrigger.SYSTEM, payload: {}, sportEventId: event.id, createdAt: at(48) } });
    await prisma.backgroundJob.create({ data: { type: 'SYNC_LEAGUE_EVENTS', trigger: JobTrigger.SYSTEM, payload: {}, sportLeagueId: other.sportLeague.id, createdAt: at(1) } });
    await prisma.backgroundJob.create({ data: { type: 'SETTLE_SPORT_EVENT_CONTESTS', trigger: JobTrigger.SYSTEM, payload: {}, sportEventId: other.event.id, createdAt: at(1) } });
    await prisma.backgroundJob.create({ data: { type: 'REBUILD_LEADERBOARDS', trigger: JobTrigger.SYSTEM, payload: {}, createdAt: at(1) } });
    const window = { createdFrom: at(24), createdTo: at(0) };
    const ids = (found: Array<{ id: string }>) => found.map((job) => job.id);

    await expect(repository().findActivity({ sportLeagueId: sportLeague.id, ...window }).then(ids)).resolves.toEqual([leagueSync.id, eventSettle.id]);
    await expect(repository().findActivity({ sportLeagueId: sportLeague.id, createdFrom: at(72), createdTo: at(0) }).then(ids))
      .resolves.toEqual([leagueSync.id, eventSettle.id, oldEventSettle.id]);
    await expect(repository().findActivity({ sportEventId: event.id, ...window }).then(ids)).resolves.toEqual([eventSettle.id]);
    await expect(repository().findActivity({ sportLeagueId: sportLeague.id, types: ['SYNC_LEAGUE_EVENTS'], ...window }).then(ids)).resolves.toEqual([leagueSync.id]);
    await expect(repository().findActivity({ sportLeagueId: sportLeague.id, status: 'QUEUED', ...window }).then(ids)).resolves.toEqual([eventSettle.id]);
    await expect(repository().findActivity(window)).resolves.toHaveLength(5);
  });

  it('lists a league with no events by its own jobs alone', async () => {
    const prisma = getPrisma();
    const sport = await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF), participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    const empty = await prisma.sportLeague.create({ data: { ...(await sportLeagueRowDefaults(prisma)), sportId: sport.id, name: `Activity Jobs Empty ${randomUUID().slice(0, 8)}` } });
    const job = await prisma.backgroundJob.create({ data: { type: 'SYNC_LEAGUE_EVENTS', trigger: JobTrigger.SYSTEM, payload: {}, sportLeagueId: empty.id } });

    await expect(repository().findActivity({ sportLeagueId: empty.id, createdFrom: new Date(Date.now() - HOUR), createdTo: new Date(Date.now() + HOUR) }))
      .resolves.toEqual([expect.objectContaining({ id: job.id, sportLeagueId: empty.id })]);
  });

  it('finds only the sync runs the named jobs ran, leaving out a run with no job, and answers none for no jobs', async () => {
    const job = await getPrisma().backgroundJob.create({ data: { type: 'MANUAL_EVENT_SYNC', trigger: JobTrigger.SYSTEM, payload: {} } });
    const runs = new PrismaProviderSyncRunRepository(getAppPrisma());
    const mine = await runs.create({
      providerCode: ProviderCode.BALLDONTLIE, ...SCHEDULED_SCORES_RUN, backgroundJobId: job.id,
      status: 'COMPLETED', startedAt: null, completedAt: null, payload: {},
    });
    await runs.create({ providerCode: ProviderCode.BALLDONTLIE, ...SCHEDULED_SCORES_RUN, status: 'COMPLETED', startedAt: null, completedAt: null, payload: {} });

    await expect(runs.findByBackgroundJobIds([job.id])).resolves.toEqual([expect.objectContaining({ id: mine.id, backgroundJobId: job.id })]);
    await expect(runs.findByBackgroundJobIds([])).resolves.toEqual([]);
  });
});

describe('manual sync runs and their job (#1441)', () => {
  const run = (feed: string) => ({
    providerCode: ProviderCode.BALLDONTLIE,
    sport: Sport.GOLF,
    ...SCHEDULED_SCORES_RUN,
    status: 'SUBMITTED' as const,
    startedAt: null,
    completedAt: null,
    payload: { requestedFeed: feed },
  });

  // Every run is keyed to the one Provider row (#2040), so the suite's runs are told apart by clearing them.
  beforeEach(async () => {
    await getPrisma().providerSyncRun.deleteMany();
  });
  afterEach(async () => {
    await getPrisma().providerSyncRun.deleteMany();
  });

  it('writes the runs, in the order given, and the job naming them in one transaction', async () => {
    const queue = new BackgroundJobQueue({ jobs: repository(), currentStart: testCurrentJobStart });

    const runs = await new PrismaProviderSyncRunRepository(getAppPrisma()).createWithJob(
      [run('EVENTPARTICIPANTS'), run('EVENTLIVESCORES')],
      (written) => queue.request(BackgroundJobType.MANUAL_EVENT_SYNC, {
        syncRunIds: written.map((one) => one.id),
        sport: Sport.GOLF,
        providerId: 'integration-background-jobs',
        eventId: 'jobs-event',
      }),
    );

    expect(runs.map((written) => written.payload['requestedFeed'])).toEqual(['EVENTPARTICIPANTS', 'EVENTLIVESCORES']);
    const job = await getPrisma().backgroundJob.findFirstOrThrow();
    expect(job).toMatchObject({ type: BackgroundJobType.MANUAL_EVENT_SYNC, status: BackgroundJobStatus.QUEUED });
    expect(job.payload).toEqual({ syncRunIds: runs.map((written) => written.id), sport: Sport.GOLF, providerId: 'integration-background-jobs', eventId: 'jobs-event' });
    await expect(new PrismaProviderSyncRunRepository(getAppPrisma()).findManyByIds(runs.map((written) => written.id)))
      .resolves.toHaveLength(2);
  });

  it('writes neither the runs nor a job when the job cannot be built', async () => {
    const queue = new BackgroundJobQueue({ jobs: repository(), currentStart: testCurrentJobStart });

    await expect(new PrismaProviderSyncRunRepository(getAppPrisma()).createWithJob(
      [run('EVENTPARTICIPANTS')],
      () => queue.request(BackgroundJobType.MANUAL_EVENT_SYNC, { syncRunIds: [], sport: Sport.GOLF, providerId: 'integration-background-jobs', eventId: 'jobs-event' }),
    )).rejects.toThrow(/Invalid MANUAL_EVENT_SYNC job payload/);

    await expect(getPrisma().providerSyncRun.count()).resolves.toBe(0);
    await expect(getPrisma().backgroundJob.count()).resolves.toBe(0);
  });
});
