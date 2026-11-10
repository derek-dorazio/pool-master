/**
 * Queues background jobs (#1439). A job's payload is checked against its type's schema here, so a
 * bad payload fails where it was made, not minutes later on another task.
 *
 * A job whose cause is written elsewhere is queued in that write's transaction: the caller builds
 * the job with `request`, hands it to the adapter writing the cause, and calls `queued` once the
 * transaction has committed. A job with no other write uses `enqueue`.
 */

import type { BackgroundJobRepository } from '@poolmaster/shared/db';
import type { BackgroundJobRequest, BackgroundJobType } from '@poolmaster/shared/domain';
import { BACKGROUND_JOB_PAYLOADS, type BackgroundJobPayload } from './background-job-payloads';

/**
 * The jobs a write carries into its own transaction, and what to call once that write has
 * committed (the runner's wake). A write that fails or is not made leaves `queued` uncalled.
 */
export interface JobsForWrite {
  jobs: readonly BackgroundJobRequest[];
  queued(): void;
}

/** No jobs, and nothing to wake: what a write carries when nothing it changes needs one. */
export const NO_JOBS_FOR_WRITE: JobsForWrite = { jobs: [], queued: () => undefined };

/** Several writes' jobs carried by one write: all of them, and each one's wake once it commits. */
export function combineJobsForWrite(...writes: readonly JobsForWrite[]): JobsForWrite {
  return {
    jobs: writes.flatMap((write) => write.jobs),
    queued: () => { for (const write of writes) write.queued(); },
  };
}

export interface BackgroundJobOptions {
  /** Due at once when omitted. */
  runAt?: Date;
  /** One job waiting for its first try per subject: a key such a job holds queues nothing. */
  dedupeKey?: string;
}

export class InvalidBackgroundJobPayloadError extends Error {
  constructor(type: BackgroundJobType, detail: string) {
    super(`Invalid ${type} job payload: ${detail}`);
    this.name = 'InvalidBackgroundJobPayloadError';
  }
}

export class BackgroundJobQueue {
  private runner?: { wake(): void };

  constructor(private readonly options: { jobs: Pick<BackgroundJobRepository, 'enqueue' | 'enqueueAll'> }) {}

  /**
   * The runner a queued job wakes, so a job on an idle system starts at once on the task that
   * queued it rather than at the next poll. Set once, when the app is built.
   */
  wakes(runner: { wake(): void }): void {
    this.runner = runner;
  }

  /** A job checked against its type's schema, for an adapter to write in the caller's transaction. */
  request<T extends BackgroundJobType>(
    type: T,
    payload: BackgroundJobPayload<T>,
    options: BackgroundJobOptions = {},
  ): BackgroundJobRequest {
    const parsed = BACKGROUND_JOB_PAYLOADS[type].safeParse(payload);
    if (!parsed.success) throw new InvalidBackgroundJobPayloadError(type, parsed.error.message);
    return { type, payload: parsed.data, runAt: options.runAt, dedupeKey: options.dedupeKey };
  }

  /** Queues one job on its own and wakes the runner; resolves to whether it was written. */
  async enqueue<T extends BackgroundJobType>(
    type: T,
    payload: BackgroundJobPayload<T>,
    options: BackgroundJobOptions = {},
  ): Promise<boolean> {
    const written = await this.options.jobs.enqueue(this.request(type, payload, options));
    this.queued();
    return written;
  }

  /** Queues jobs built with `request` in one write and wakes the runner; resolves to how many were written. */
  async enqueueAll(requests: readonly BackgroundJobRequest[]): Promise<number> {
    if (requests.length === 0) return 0;
    const written = await this.options.jobs.enqueueAll(requests);
    this.queued();
    return written;
  }

  /** A job the caller wrote in its own transaction has committed: run it now. */
  queued(): void {
    this.runner?.wake();
  }
}
