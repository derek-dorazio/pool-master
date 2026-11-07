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

export interface BackgroundJobOptions {
  /** Due at once when omitted. */
  runAt?: Date;
  /** One pending job per subject: a key a queued job holds queues nothing. */
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

  constructor(private readonly options: { jobs: Pick<BackgroundJobRepository, 'enqueue'> }) {}

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

  /** A job the caller wrote in its own transaction has committed: run it now. */
  queued(): void {
    this.runner?.wake();
  }
}
