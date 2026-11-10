import { BackgroundJobStatus, BackgroundJobType, Sport } from '@poolmaster/shared/domain';
import {
  BACKGROUND_JOB_LEASE_MS,
  BackgroundJobQueue,
  BackgroundJobRunner,
  readBackgroundJobPollMs,
  type BackgroundJobContext,
  type BackgroundJobHandlers,
  type BackgroundJobPayload,
} from '../../../packages/core-api/src/modules/background-jobs';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryBackgroundJobs, jobHandlers, type InMemoryBackgroundJobs } from '../../support/in-memory-background-jobs';

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
  handler?: (payload: SyncPayload, context: BackgroundJobContext) => Promise<void>;
  concurrency?: number;
} = {}) {
  const time = clock();
  const jobs = inMemoryBackgroundJobs(time.now);
  const logger = fakeLogger();
  const handler = jest.fn(options.handler ?? (() => Promise.resolve()));
  const handlers: BackgroundJobHandlers = jobHandlers({ MANUAL_EVENT_SYNC: handler });
  const runner = new BackgroundJobRunner({
    jobs,
    handlers,
    concurrency: options.concurrency,
    logger,
    now: time.now,
    sleep: () => Promise.resolve(),
  });
  const queue = new BackgroundJobQueue({ jobs });
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
    expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.FAILED, attempts: 4, lastError: 'provider timed out', completedAt: time.now() });
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'backgroundJobs.failed' }), expect.any(String));
    expect(logger.error.mock.calls[0][0]).toMatchObject({ data: { type: 'MANUAL_EVENT_SYNC', attempt: 4 } });
    // FAILED is final: later passes never run it again.
    time.advance(60 * MINUTE);
    await runner.drain();
    expect(handler).toHaveBeenCalledTimes(4);
  });

  it('marks a job whose stored payload fails its schema FAILED at once, without running the handler or retrying it', async () => {
    const { jobs, handler, runner, logger } = setup();
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: { syncRunIds: [], sport: 'CROQUET' } });

    await runner.drain();

    expect(handler).not.toHaveBeenCalled();
    expect(only(jobs).status).toBe(BackgroundJobStatus.FAILED);
    expect(only(jobs).lastError).toMatch(/^Invalid payload: /);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'backgroundJobs.invalidPayload' }), expect.any(String));
  });

  it('runs again a job left RUNNING by a stopped task once its lease ends, and not before', async () => {
    const { jobs, handler, runner, time } = setup();
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload() });
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
        if (context.attempt !== 1) return;
        // The first try runs past its lease; another task claims the job and finishes it meanwhile.
        time.advance(BACKGROUND_JOB_LEASE_MS);
        const [reclaimed] = await jobs.claimDue({ now: time.now(), limit: 1, leaseUntil: new Date(time.now().getTime() + BACKGROUND_JOB_LEASE_MS) });
        await jobs.markSucceeded(reclaimed, time.now());
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
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload() });
    for (let lapsed = 0; lapsed < 4; lapsed++) {
      await jobs.claimDue({ now: time.now(), limit: 1, leaseUntil: new Date(time.now().getTime() + BACKGROUND_JOB_LEASE_MS) });
      time.advance(BACKGROUND_JOB_LEASE_MS);
    }

    await runner.drain();

    expect(handler).not.toHaveBeenCalled();
    expect(only(jobs)).toMatchObject({ status: BackgroundJobStatus.FAILED, attempts: 5, lastError: 'Gave up: every lease on this job lapsed' });
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
      },
    });
    queue.wakes(runner);
    queueAnother = async () => { await queue.enqueue(BackgroundJobType.MANUAL_EVENT_SYNC, syncPayload(2)); };
    await jobs.enqueue({ type: BackgroundJobType.MANUAL_EVENT_SYNC, payload: syncPayload(1) });

    await runner.drain();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(jobs.rows.map((row) => row.status)).toEqual([BackgroundJobStatus.SUCCEEDED, BackgroundJobStatus.SUCCEEDED]);
  });

  it('once stopped, claims nothing more, while the job in flight still finishes', async () => {
    let release: (() => void) | undefined;
    const { jobs, handler, runner, queue } = setup({
      concurrency: 1,
      handler: () => new Promise<void>((resolve) => { release = resolve; }),
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
