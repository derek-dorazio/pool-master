import { BackgroundJobStatus, BackgroundJobType, JobErrorType, JobTrigger, Sport } from '@poolmaster/shared/domain';
import {
  BACKGROUND_JOB_LEASE_MS,
  BackgroundJobQueue,
  BackgroundJobRunner,
  DISCARD_BACKGROUND_JOB,
  PermanentBackgroundJobError,
  readBackgroundJobMaxTasks,
  readBackgroundJobPollMs,
  type BackgroundJobAnswer,
  type BackgroundJobContext,
  type BackgroundJobHandlers,
  type BackgroundJobPayload,
} from '../../../packages/core-api/src/modules/background-jobs';
import { fakeLogger } from '../../support/fake-logger';
import { ProviderRateLimitedError } from '../../../packages/core-api/src/modules/ingestion/core/provider-call-policy';
import { inMemoryBackgroundJobs, jobHandlers, TEST_JOB_START, type InMemoryBackgroundJobs, testCurrentJobStart } from '../../support/in-memory-background-jobs';

const START = new Date('2026-11-07T12:00:00.000Z').getTime();
const MINUTE = 60_000;

type SyncPayload = BackgroundJobPayload<typeof BackgroundJobType.MANUAL_EVENT_SYNC>;

function syncPayload(index = 1): SyncPayload {
  return {
    syncRunIds: [`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`],
    sport: Sport.GOLF,
    providerId: 'mock-provider',
    eventId: `event-${String(index)}`,
  };
}

function clock() {
  let now = START;
  return {
    now: () => new Date(now),
    advance: (ms: number) => { now += ms; },
  };
}

function setup(options: {
  handler?: (payload: SyncPayload, context: BackgroundJobContext) => Promise<BackgroundJobAnswer>;
  concurrency?: number;
} = {}) {
  const time = clock();
  const jobs = inMemoryBackgroundJobs(time.now);
  const logger = fakeLogger();
  const handler = jest.fn(options.handler ?? (() => Promise.resolve({ changedCount: 0 })));
  const handlers: BackgroundJobHandlers = jobHandlers({ MANUAL_EVENT_SYNC: handler });
  const runner = new BackgroundJobRunner({
    jobs,
    handlers,
    concurrency: options.concurrency,
    logger,
    now: time.now,
    sleep: () => Promise.resolve(),
  });
  const queue = new BackgroundJobQueue({ jobs, currentStart: testCurrentJobStart });
  return { time, jobs, logger, handler, runner, queue };
}

function only(jobs: InMemoryBackgroundJobs) {
  expect(jobs.rows).toHaveLength(1);
  return jobs.rows[0];
}

describe('background job runner (#1440)', () => {
  it('runs a due job with its type\'s handler, passing its payload, id and attempt, and marks it SUCCEEDED', async () => {
    const { jobs, handler, runner, queue, time } = setup();
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    await runner.drain();

    const job = only(jobs);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(syncPayload(), expect.objectContaining({ jobId: job.id, attempt: 1 }));
    expect(job).toMatchObject({ status: BackgroundJobStatus.SUCCEEDED, attempts: 1, completedAt: time.now() });
    expect(job.leaseUntil).toBeUndefined();
  });

  it('lets a long handler renew its lease to a full lease from now, so no other task claims it mid-run (#1819)', async () => {
    let leaseAfterRenewal: Date | undefined;
    let renewed: boolean | undefined;
    const { jobs, runner, queue, time } = setup({
      handler: async (_payload, context) => {
        time.advance(4 * MINUTE);
        renewed = await context.renewLease();
        leaseAfterRenewal = jobs.rows[0].leaseUntil;
        return { changedCount: 0 };
      },
    });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    await runner.drain();

    expect(renewed).toBe(true);
    expect(leaseAfterRenewal).toEqual(new Date(START + 4 * MINUTE + BACKGROUND_JOB_LEASE_MS));
  });

  it('answers false to a renewal once another task has claimed the job, and writes no lease', async () => {
    let renewed: boolean | undefined;
    let leaseBefore: Date | undefined;
    let leaseAfter: Date | undefined;
    const { jobs, runner, queue, time } = setup({
      handler: async (_payload, context) => {
        jobs.rows[0].attempts += 1;
        leaseBefore = jobs.rows[0].leaseUntil;
        time.advance(MINUTE);
        renewed = await context.renewLease();
        leaseAfter = jobs.rows[0].leaseUntil;
        return { changedCount: 0 };
      },
    });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    await runner.drain();

    expect(renewed).toBe(false);
    expect(leaseAfter).toEqual(leaseBefore);
  });

  it('keeps what a handler reports it did on the SUCCEEDED job, its changed rows and its result, for Activity to show (#1819, #1861)', async () => {
    const { jobs, runner, queue } = setup({ handler: () => Promise.resolve({ changedCount: 3, result: { created: 2, updated: 1 } }) });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    await runner.drain();

    expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.SUCCEEDED, changedCount: 3, result: { created: 2, updated: 1 } });
    expect(only(jobs).errorType).toBeUndefined();
  });

  it('keeps no result on a job whose handler reports nothing', async () => {
    const { jobs, runner, queue } = setup();
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    await runner.drain();

    expect(only(jobs).result).toBeUndefined();
  });

  it('deletes the job whose handler answers there is nothing to keep, leaving no row for Activity (#1865)', async () => {
    const { jobs, runner, queue, logger } = setup({ handler: () => Promise.resolve(DISCARD_BACKGROUND_JOB) });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    await runner.drain();

    expect(jobs.rows).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ action: 'backgroundJobs.discarded' }), expect.any(String));
  });

  it('deletes nothing for a discarding try that outran its lease and was claimed again, so the newer attempt\'s row stands', async () => {
    const { jobs, runner, queue, time, logger } = setup({
      handler: async (_payload, context) => {
        if (context.attempt !== 1) return { changedCount: 0 };
        time.advance(BACKGROUND_JOB_LEASE_MS);
        const [reclaimed] = await jobs.claimDue({ now: time.now(), limit: 1, leaseUntil: new Date(time.now().getTime() + BACKGROUND_JOB_LEASE_MS) });
        await jobs.markSucceeded(reclaimed, time.now(), { changedCount: 0 });
        return DISCARD_BACKGROUND_JOB;
      },
    });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    await runner.drain();

    expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.SUCCEEDED, attempts: 2 });
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'backgroundJobs.claimLost' }), expect.any(String));
  });

  it('records the kind of a failure its error carries, a provider\'s 429 as RATE_LIMITED (#1861)', async () => {
    const rateLimited = Object.assign(new Error('BALLDONTLIE answered 429'), { jobErrorType: JobErrorType.RATE_LIMITED });
    const { jobs, runner, queue } = setup({ handler: () => Promise.reject(rateLimited) });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    await runner.drain();

    expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.QUEUED, errorType: JobErrorType.RATE_LIMITED });
    expect(only(jobs).changedCount).toBeUndefined();
  });

  it('records a hold a handler reports, a release check that failed, as CHECK_FAILED on the SUCCEEDED job (#1861)', async () => {
    const { jobs, runner, queue } = setup({ handler: () => Promise.resolve({ changedCount: 0, heldBack: JobErrorType.CHECK_FAILED }) });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    await runner.drain();

    expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.SUCCEEDED, changedCount: 0, errorType: JobErrorType.CHECK_FAILED });
  });

  it('hands the handler its job\'s trigger, and records SYSTEM on every job the handler queues in turn (#1861)', async () => {
    let queueFollowUp: (() => Promise<unknown>) | undefined;
    const { jobs, runner, queue, handler } = setup({
      handler: async () => {
        const next = queueFollowUp;
        queueFollowUp = undefined;
        await next?.();
        return { changedCount: 0 };
      },
    });
    queueFollowUp = () => queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload(2));
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload(1), start: { trigger: JobTrigger.WEBHOOK } });

    await runner.drain();

    expect(handler.mock.calls.map(([, context]) => context.trigger)).toEqual([JobTrigger.WEBHOOK, JobTrigger.SYSTEM]);
    expect(jobs.rows.map((row) => row.trigger)).toEqual([JobTrigger.WEBHOOK, JobTrigger.SYSTEM]);
  });

  it('marks a job whose handler throws a permanent failure FAILED on that try, without retrying it, and logs an error (#1819)', async () => {
    const { jobs, runner, queue, logger, handler } = setup({ handler: () => Promise.reject(new PermanentBackgroundJobError('PROVIDER_LEAGUE_REFUSED: not in the plan')) });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    await runner.drain();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.FAILED, attempts: 1 });
    expect(only(jobs).lastError).toContain('PROVIDER_LEAGUE_REFUSED');
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'backgroundJobs.failed' }), expect.any(String));
  });

  it('queues a job a provider\'s rate limit turned away again for the time the provider will answer, without counting the try', async () => {
    let calls = 0;
    let now = () => new Date(START);
    const { jobs, runner, queue, logger, handler, time } = setup({
      handler: () => {
        calls += 1;
        if (calls <= 5) {
          const deferUntil = new Date(now().getTime() + 2 * MINUTE);
          return Promise.reject(new Error('feed failed', { cause: new ProviderRateLimitedError('BALLDONTLIE', deferUntil, 'its circuit is open') }));
        }
        return Promise.resolve({ changedCount: 1 });
      },
    });
    now = time.now;
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    await runner.drain();

    expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.QUEUED, runAt: new Date(START + 2 * MINUTE), attempts: 0, errorType: JobErrorType.RATE_LIMITED });
    expect(only(jobs).lastError).toContain('BALLDONTLIE is rate limiting PoolMaster');
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'backgroundJobs.deferred' }), expect.any(String));

    // Turned away more times than the job's attempts allow, it still runs once the provider answers.
    for (let turn = 0; turn < 4; turn += 1) {
      time.advance(2 * MINUTE);
      await runner.drain();
      expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.QUEUED, attempts: 0 });
    }
    time.advance(2 * MINUTE);
    await runner.drain();

    expect(handler).toHaveBeenCalledTimes(6);
    expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.SUCCEEDED, attempts: 1 });
    expect(handler).toHaveBeenLastCalledWith(syncPayload(), expect.objectContaining({ attempt: 1 }));
  });

  it('fails a permanent failure for good even when its cause was a rate limit, so a refused league is never deferred forever', async () => {
    const cause = new ProviderRateLimitedError('BALLDONTLIE', new Date(START + MINUTE), 'still 429 after every retry');
    const { jobs, runner, queue } = setup({ handler: () => Promise.reject(new PermanentBackgroundJobError('gone', { cause })) });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    await runner.drain();

    expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.FAILED, attempts: 1 });
  });

  it('records nothing from a deferred try that outran its lease and was claimed again', async () => {
    const { jobs, runner, queue, logger } = setup({
      handler: () => {
        jobs.rows[0].attempts += 1;
        return Promise.reject(new ProviderRateLimitedError('BALLDONTLIE', new Date(START + MINUTE), 'its circuit is open'));
      },
    });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    await runner.drain();

    expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.RUNNING, attempts: 2 });
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'backgroundJobs.claimLost' }), expect.any(String));
  });

  it('leaves a job queued for later untouched until its run time comes', async () => {
    const { jobs, handler, runner, queue, time } = setup();
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload(), { runAt: new Date(START + 5 * MINUTE) });

    await runner.drain();
    expect(handler).not.toHaveBeenCalled();
    expect(only(jobs).status).toBe(BackgroundJobStatus.QUEUED);

    time.advance(5 * MINUTE);
    await runner.drain();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(only(jobs).status).toBe(BackgroundJobStatus.SUCCEEDED);
  });

  it('retries a failing job 1, 5 and 30 minutes later, then marks it FAILED with the error and logs an error', async () => {
    const { jobs, handler, runner, queue, time, logger } = setup({
      handler: () => Promise.reject(new Error('provider timed out')),
    });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    for (const delay of [MINUTE, 5 * MINUTE, 30 * MINUTE]) {
      const failedAt = time.now().getTime();
      await runner.drain();
      expect(only(jobs)).toMatchObject({
        status: BackgroundJobStatus.QUEUED,
        runAt: new Date(failedAt + delay),
        lastError: 'provider timed out',
        errorType: JobErrorType.OTHER,
      });
      // Not due again until the delay has passed.
      time.advance(delay - 1);
      await runner.drain();
      expect(only(jobs).status).toBe(BackgroundJobStatus.QUEUED);
      time.advance(1);
    }
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.error).not.toHaveBeenCalled();

    await runner.drain();

    expect(handler).toHaveBeenCalledTimes(4);
    expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.FAILED, attempts: 4, lastError: 'provider timed out', errorType: JobErrorType.OTHER, completedAt: time.now() });
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'backgroundJobs.failed' }), expect.any(String));
    expect(logger.error.mock.calls[0][0]).toMatchObject({ data: { type: 'MANUAL_EVENT_SYNC', attempt: 4 } });
    // FAILED is final: later passes never run it again.
    time.advance(60 * MINUTE);
    await runner.drain();
    expect(handler).toHaveBeenCalledTimes(4);
  });

  it('marks a job whose stored payload fails its schema FAILED at once, without running the handler or retrying it', async () => {
    const { jobs, handler, runner, logger } = setup();
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: { syncRunIds: [], sport: 'CROQUET' }, start: TEST_JOB_START });

    await runner.drain();

    expect(handler).not.toHaveBeenCalled();
    expect(only(jobs).status).toBe(BackgroundJobStatus.FAILED);
    expect(only(jobs).lastError).toMatch(/^Invalid payload: /);
    expect(only(jobs).errorType).toBe(JobErrorType.BAD_DATA);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'backgroundJobs.invalidPayload' }), expect.any(String));
  });

  it('runs again a job left RUNNING by a stopped task once its lease ends, and not before', async () => {
    const { jobs, handler, runner, time } = setup();
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload(), start: TEST_JOB_START });
    // Another task claimed it and stopped mid-run.
    await jobs.claimDue({ now: time.now(), limit: 1, leaseUntil: new Date(START + BACKGROUND_JOB_LEASE_MS) });

    time.advance(BACKGROUND_JOB_LEASE_MS - 1);
    await runner.drain();
    expect(handler).not.toHaveBeenCalled();

    time.advance(1);
    await runner.drain();
    expect(handler).toHaveBeenCalledWith(syncPayload(), expect.objectContaining({ attempt: 2 }));
    expect(only(jobs).status).toBe(BackgroundJobStatus.SUCCEEDED);
  });

  it('records nothing from a try that outran its lease and was claimed again, so the newer attempt\'s outcome stands', async () => {
    const { jobs, runner, queue, time, logger } = setup({
      handler: async (_payload, context) => {
        if (context.attempt !== 1) return { changedCount: 0 };
        // The first try runs past its lease; another task claims the job and finishes it meanwhile.
        time.advance(BACKGROUND_JOB_LEASE_MS);
        const [reclaimed] = await jobs.claimDue({ now: time.now(), limit: 1, leaseUntil: new Date(time.now().getTime() + BACKGROUND_JOB_LEASE_MS) });
        await jobs.markSucceeded(reclaimed, time.now(), { changedCount: 0 });
        throw new Error('first try failed late');
      },
    });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    await runner.drain();

    expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.SUCCEEDED, attempts: 2 });
    expect(only(jobs).lastError).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'backgroundJobs.claimLost' }), expect.any(String));
  });

  it('gives up with an error log on a job whose leases lapsed on every try, without running it a fifth time', async () => {
    const { jobs, handler, runner, time, logger } = setup();
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload(), start: TEST_JOB_START });
    for (let lapsed = 0; lapsed < 4; lapsed++) {
      await jobs.claimDue({ now: time.now(), limit: 1, leaseUntil: new Date(time.now().getTime() + BACKGROUND_JOB_LEASE_MS) });
      time.advance(BACKGROUND_JOB_LEASE_MS);
    }

    await runner.drain();

    expect(handler).not.toHaveBeenCalled();
    expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.FAILED, attempts: 5, lastError: 'Gave up: every lease on this job lapsed', errorType: JobErrorType.TIMEOUT });
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'backgroundJobs.abandoned' }), expect.any(String));
  });

  it('claims no more jobs at a time than its concurrency, and still runs every due job in one drain', async () => {
    let running = 0;
    let mostAtOnce = 0;
    const { jobs, handler, runner, queue } = setup({
      concurrency: 2,
      handler: async () => {
        running++;
        mostAtOnce = Math.max(mostAtOnce, running);
        await Promise.resolve();
        running--;
        return { changedCount: 0 };
      },
    });
    for (let index = 1; index <= 5; index++) {
      await jobs.enqueue(queue.request(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload(index)));
    }

    await runner.drain();

    expect(handler).toHaveBeenCalledTimes(5);
    expect(mostAtOnce).toBe(2);
    expect(jobs.claimLimits.every((limit) => limit >= 1 && limit <= 2)).toBe(true);
    expect(jobs.rows.every((row) => row.status === BackgroundJobStatus.SUCCEEDED)).toBe(true);
  });

  it('keeps running short jobs in the free slot while one slow job holds the other, instead of waiting for it (#1447)', async () => {
    let releaseSlow: (() => void) | undefined;
    const finished: string[] = [];
    const { jobs, runner, queue } = setup({
      concurrency: 2,
      handler: async (payload) => {
        if (payload.eventId === 'event-1') {
          await new Promise<void>((resolve) => { releaseSlow = resolve; });
        }
        finished.push(payload.eventId);
        return { changedCount: 0 };
      },
    });
    for (let index = 1; index <= 4; index++) {
      await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload(index));
    }

    const draining = runner.drain();
    for (let turn = 0; turn < 20 && finished.length < 3; turn++) {
      await new Promise((resolve) => { setImmediate(resolve); });
    }
    const finishedWhileSlowRan = [...finished];
    releaseSlow?.();
    await draining;

    expect(finishedWhileSlowRan).toEqual(['event-2', 'event-3', 'event-4']);
    expect(finished).toEqual(['event-2', 'event-3', 'event-4', 'event-1']);
    expect(jobs.rows.every((row) => row.status === BackgroundJobStatus.SUCCEEDED)).toBe(true);
  });

  it('claims a job queued while a slow job runs into the free slot at once, without waiting for the slow job', async () => {
    let releaseSlow: (() => void) | undefined;
    const finished: string[] = [];
    const { runner, queue } = setup({
      concurrency: 2,
      handler: async (payload) => {
        if (payload.eventId === 'event-1') {
          await new Promise<void>((resolve) => { releaseSlow = resolve; });
        }
        finished.push(payload.eventId);
        return { changedCount: 0 };
      },
    });
    queue.wakes(runner);
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload(1));
    const draining = runner.drain();
    await new Promise((resolve) => { setImmediate(resolve); });

    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload(2));
    for (let turn = 0; turn < 20 && finished.length < 1; turn++) {
      await new Promise((resolve) => { setImmediate(resolve); });
    }
    const finishedWhileSlowRan = [...finished];
    releaseSlow?.();
    await draining;

    expect(finishedWhileSlowRan).toEqual(['event-2']);
    expect(finished).toEqual(['event-2', 'event-1']);
  });

  it('runs a job queued while a drain is running before that drain ends, rather than leaving it for the next poll', async () => {
    let queueAnother: (() => Promise<void>) | undefined;
    const { jobs, handler, runner, queue } = setup({
      handler: async () => {
        const next = queueAnother;
        queueAnother = undefined;
        await next?.();
        return { changedCount: 0 };
      },
    });
    queue.wakes(runner);
    queueAnother = async () => { await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload(2)); };
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload(1), start: TEST_JOB_START });

    await runner.drain();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(jobs.rows.map((row) => row.status)).toEqual([BackgroundJobStatus.SUCCEEDED, BackgroundJobStatus.SUCCEEDED]);
  });

  it('once stopped, claims nothing more, while the job in flight still finishes', async () => {
    let release: (() => void) | undefined;
    const { jobs, handler, runner, queue } = setup({
      concurrency: 1,
      handler: async () => {
        await new Promise<void>((resolve) => { release = resolve; });
        return { changedCount: 0 };
      },
    });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload(1));
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload(2));

    const draining = runner.drain();
    await new Promise((resolve) => { setImmediate(resolve); });
    expect(handler).toHaveBeenCalledTimes(1);
    const stopping = runner.stop();
    release?.();
    await Promise.all([draining, stopping]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(jobs.rows.map((row) => row.status)).toEqual([BackgroundJobStatus.SUCCEEDED, BackgroundJobStatus.QUEUED]);
    await runner.drain();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('never rejects a drain when a claim fails: it logs the error and the next drain runs the job', async () => {
    const { jobs, handler, runner, queue, logger } = setup();
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());
    const claimDue = jobs.claimDue;
    jobs.claimDue = () => Promise.reject(new Error('connection reset'));

    await expect(runner.drain()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'backgroundJobs.runner.failure' }), expect.any(String));

    jobs.claimDue = claimDue;
    await runner.drain();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('records a failure with its cause, and a thrown value that is not an Error as text', async () => {
    const failures = [new Error('sync failed', { cause: new Error('provider timed out') }), 'rate limited'];
    const { jobs, runner, queue } = setup({ handler: async () => { throw failures.shift() as unknown; } });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload(1));
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload(2));

    await runner.drain();

    expect(jobs.rows.map((row) => row.lastError).sort((left, right) => String(left).localeCompare(String(right))))
      .toEqual(['rate limited', 'sync failed: provider timed out']);
  });

  it('logs a failure it cannot record and leaves the job for its lease to lapse', async () => {
    const { jobs, runner, queue, logger } = setup({ handler: () => Promise.reject(new Error('provider timed out')) });
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());
    jobs.markRetry = () => Promise.reject(new Error('connection reset'));

    await runner.drain();

    expect(only(jobs).status).toBe(BackgroundJobStatus.RUNNING);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'backgroundJobs.recordFailure' }),
      expect.any(String),
    );
  });

  it('starts polling once however often started, runs what is due at once, and stops polling when stopped', async () => {
    const { jobs, runner, queue, logger } = setup();
    await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload());

    runner.start();
    runner.start();
    await runner.stop();
    await runner.stop();

    expect(logger.info.mock.calls.filter(([entry]) => (entry as { action: string }).action === 'backgroundJobs.runner.start')).toHaveLength(1);
    expect(only(jobs).status).toBe(BackgroundJobStatus.SUCCEEDED);
  });
});

describe('background job poll interval (#1440)', () => {
  it('is ten seconds unless BACKGROUND_JOB_POLL_MS sets a whole number of milliseconds above 0', () => {
    expect(readBackgroundJobPollMs({})).toBe(10_000);
    expect(readBackgroundJobPollMs({ BACKGROUND_JOB_POLL_MS: '' })).toBe(10_000);
    expect(readBackgroundJobPollMs({ BACKGROUND_JOB_POLL_MS: '200' })).toBe(200);
  });

  it.each(['0', '-5', '1.5', 'soon'])('refuses to start when BACKGROUND_JOB_POLL_MS is "%s"', (raw) => {
    expect(() => readBackgroundJobPollMs({ BACKGROUND_JOB_POLL_MS: raw })).toThrow(/BACKGROUND_JOB_POLL_MS must be a whole number/);
  });
});

describe('background job task pool size (league model 1c)', () => {
  it('is 1 unless BACKGROUND_JOB_MAX_TASKS sets a whole number above 0', () => {
    expect(readBackgroundJobMaxTasks({})).toBe(1);
    expect(readBackgroundJobMaxTasks({ BACKGROUND_JOB_MAX_TASKS: '' })).toBe(1);
    expect(readBackgroundJobMaxTasks({ BACKGROUND_JOB_MAX_TASKS: '3' })).toBe(3);
  });

  it.each(['0', '-1', '2.5', 'many'])('refuses to start when BACKGROUND_JOB_MAX_TASKS is "%s"', (raw) => {
    expect(() => readBackgroundJobMaxTasks({ BACKGROUND_JOB_MAX_TASKS: raw })).toThrow(/BACKGROUND_JOB_MAX_TASKS must be a whole number above 0/);
  });
});
