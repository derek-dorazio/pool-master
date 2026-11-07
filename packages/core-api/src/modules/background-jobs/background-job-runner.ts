/**
 * The background job runner (#1439): claims due jobs and runs each with its type's handler. It
 * runs in every core-api task; the claim skips rows another task holds, so two tasks never run
 * one job. A queued job wakes it, and a poll catches retries, lapsed leases and jobs queued on
 * another task.
 *
 * A handler that throws is tried again 1, 5 and 30 minutes later, then the job is FAILED with an
 * error log. A task that stops mid-job leaves it RUNNING until its lease ends, and the next claim
 * after that runs it again, so every handler is idempotent.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { BackgroundJobRepository } from '@poolmaster/shared/db';
import type { BackgroundJob, BackgroundJobType } from '@poolmaster/shared/domain';
import { outsideRequest } from '../../core/request-scope';
import { BACKGROUND_JOB_PAYLOADS, type BackgroundJobPayload } from './background-job-payloads';

/** How long after each failed try the next one is due: 1, 5 and 30 minutes, then FAILED. */
export const BACKGROUND_JOB_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;
export const BACKGROUND_JOB_MAX_ATTEMPTS = BACKGROUND_JOB_RETRY_DELAYS_MS.length + 1;
/** A claim holds a job this long; past it the job is due again on any task. */
export const BACKGROUND_JOB_LEASE_MS = 5 * 60_000;
/** How often the runner looks for due jobs, unless the environment sets another. */
export const BACKGROUND_JOB_POLL_MS = 1000;
/** Jobs a task runs at once: few, so a burst of jobs never takes the pool that serves requests. */
export const BACKGROUND_JOB_CONCURRENCY = 2;
/** How long a stopping task waits for its jobs in flight; a lapsed lease re-runs the rest. */
const SHUTDOWN_GRACE_MS = 10_000;

/** What a handler is told about the job it runs. */
export interface BackgroundJobContext {
  jobId: string;
  /** 1 on the first try. */
  attempt: number;
  logger?: FastifyBaseLogger;
}

/** One handler per job type, exhaustive, so a new type without a handler fails typecheck. */
export type BackgroundJobHandlers = {
  [T in BackgroundJobType]: (payload: BackgroundJobPayload<T>, context: BackgroundJobContext) => Promise<void>;
};

export interface BackgroundJobRunnerOptions {
  jobs: Pick<BackgroundJobRepository, 'claimDue' | 'markSucceeded' | 'markRetry' | 'markFailed'>;
  handlers: BackgroundJobHandlers;
  pollMs?: number;
  concurrency?: number;
  logger?: FastifyBaseLogger;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The poll interval the environment variable BACKGROUND_JOB_POLL_MS sets, in milliseconds, else
 * one second. Anything but a whole number above 0 refuses to start.
 */
export function readBackgroundJobPollMs(env: NodeJS.ProcessEnv): number {
  const raw = env['BACKGROUND_JOB_POLL_MS'];
  if (raw === undefined || raw === '') return BACKGROUND_JOB_POLL_MS;
  const pollMs = Number(raw);
  if (!Number.isInteger(pollMs) || pollMs <= 0) {
    throw new Error(`BACKGROUND_JOB_POLL_MS must be a whole number of milliseconds above 0; got "${raw}"`);
  }
  return pollMs;
}

export class BackgroundJobRunner {
  private timer?: ReturnType<typeof setInterval>;
  private draining?: Promise<void>;
  /** Counts wakes, so a drain can tell whether one came while it was running jobs. */
  private wakes = 0;
  private stopping = false;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly concurrency: number;

  constructor(private readonly options: BackgroundJobRunnerOptions) {
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref(); }));
    this.concurrency = options.concurrency ?? BACKGROUND_JOB_CONCURRENCY;
  }

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => { void this.drain(); }, this.options.pollMs ?? BACKGROUND_JOB_POLL_MS);
    this.timer.unref();
    void this.drain();
    this.options.logger?.info({ action: 'backgroundJobs.runner.start' }, 'Background job runner started');
  }

  /**
   * Stops claiming and waits a short grace period for the jobs in flight. A job still running
   * after it keeps its lease, and another task runs it again once the lease ends.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.draining) await Promise.race([this.draining, this.sleep(SHUTDOWN_GRACE_MS)]);
  }

  /** A job was queued: run it now rather than at the next poll. */
  wake(): void {
    void this.drain();
  }

  /**
   * Runs every due job and resolves once none is left. A wake during a drain makes it look again
   * before it ends, so a job queued meanwhile is not left for the next poll. Never rejects: a
   * failure is logged and the next poll tries again.
   *
   * A drain a request wakes runs outside that request: it is shared by every later wake, and
   * neither the request's read memo nor its query budget is its own.
   */
  drain(): Promise<void> {
    if (this.stopping) return this.draining ?? Promise.resolve();
    this.wakes++;
    if (this.draining) return this.draining;
    this.draining = outsideRequest(() => this.run());
    return this.draining;
  }

  private async run(): Promise<void> {
    try {
      let wakesSeen: number;
      do {
        wakesSeen = this.wakes;
        await this.runDue();
      } while (this.wakes !== wakesSeen && !this.stopping);
    } catch (err) {
      this.options.logger?.error({
        action: 'backgroundJobs.runner.failure',
        data: { error: describeError(err) },
      }, 'Background job pass failed; the next poll tries again');
    } finally {
      // Cleared in the same step as the last wake check, so a later wake starts a new drain.
      this.draining = undefined;
    }
  }

  /** Claims up to `concurrency` jobs at a time and runs them, until a claim comes back short. */
  private async runDue(): Promise<void> {
    while (!this.stopping) {
      const now = this.now();
      // poolmaster-allow-query-in-loop: one claim per batch of up to the concurrency, not per job
      const batch = await this.options.jobs.claimDue({
        now,
        limit: this.concurrency,
        leaseUntil: new Date(now.getTime() + BACKGROUND_JOB_LEASE_MS),
      });
      await Promise.all(batch.map((job) => this.runOne(job)));
      if (batch.length < this.concurrency) return;
    }
  }

  private async runOne(job: BackgroundJob): Promise<void> {
    const refs = { jobId: job.id, type: job.type, attempt: job.attempts };
    try {
      if (job.attempts > BACKGROUND_JOB_MAX_ATTEMPTS) {
        // Only a lease that lapsed again and again gets here: each task running it stopped mid-run.
        if (!await this.options.jobs.markFailed(job, { error: 'Gave up: every lease on this job lapsed', completedAt: this.now() })) {
          this.lostClaim(job);
          return;
        }
        this.options.logger?.error({ action: 'backgroundJobs.abandoned', data: refs }, 'Gave up on a background job whose leases kept lapsing');
        return;
      }
      const parsed = BACKGROUND_JOB_PAYLOADS[job.type].safeParse(job.payload);
      if (!parsed.success) {
        // A payload that fails its schema fails every try alike, so it is not retried.
        const error = `Invalid payload: ${parsed.error.message}`;
        if (!await this.options.jobs.markFailed(job, { error, completedAt: this.now() })) {
          this.lostClaim(job);
          return;
        }
        this.options.logger?.error({ action: 'backgroundJobs.invalidPayload', data: { ...refs, error } }, 'A background job\'s payload is invalid; it will not run');
        return;
      }
      const startedAt = this.now().getTime();
      // The registry is exhaustive over the type, so the handler for `job.type` reads this payload.
      const handler = this.options.handlers[job.type] as (payload: unknown, context: BackgroundJobContext) => Promise<void>;
      await handler(parsed.data, { jobId: job.id, attempt: job.attempts, logger: this.options.logger });
      if (!await this.options.jobs.markSucceeded(job, this.now())) {
        this.lostClaim(job);
        return;
      }
      this.options.logger?.info({
        action: 'backgroundJobs.succeeded',
        data: { ...refs, durationMs: this.now().getTime() - startedAt },
      }, 'Background job succeeded');
    } catch (err) {
      await this.recordFailure(job, err);
    }
  }

  /**
   * This try outran its lease and the job was claimed again: the newer attempt's outcome stands,
   * so this one's is not written.
   */
  private lostClaim(job: BackgroundJob): void {
    this.options.logger?.warn({
      action: 'backgroundJobs.claimLost',
      data: { jobId: job.id, type: job.type, attempt: job.attempts },
    }, 'A background job outran its lease and was claimed again; this try\'s outcome was not recorded');
  }

  private async recordFailure(job: BackgroundJob, err: unknown): Promise<void> {
    const error = describeError(err);
    const refs = { jobId: job.id, type: job.type, attempt: job.attempts, error };
    try {
      if (job.attempts <= BACKGROUND_JOB_RETRY_DELAYS_MS.length) {
        const retryInMs = BACKGROUND_JOB_RETRY_DELAYS_MS[job.attempts - 1];
        if (!await this.options.jobs.markRetry(job, { runAt: new Date(this.now().getTime() + retryInMs), error })) {
          this.lostClaim(job);
          return;
        }
        this.options.logger?.warn({ action: 'backgroundJobs.retry', data: { ...refs, retryInMs } }, 'Background job failed; it will be tried again');
        return;
      }
      if (!await this.options.jobs.markFailed(job, { error, completedAt: this.now() })) {
        this.lostClaim(job);
        return;
      }
      this.options.logger?.error({ action: 'backgroundJobs.failed', data: refs }, 'Background job failed on its last try; it will not run again');
    } catch (recordErr) {
      // The lease lapses and the job is tried again.
      this.options.logger?.error({
        action: 'backgroundJobs.recordFailure',
        data: { ...refs, recordError: describeError(recordErr) },
      }, 'Could not record a background job failure');
    }
  }
}

/** The error and what caused it. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? `: ${err.cause.message}` : '';
  return `${err.message}${cause}`;
}
