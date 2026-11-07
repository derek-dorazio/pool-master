/**
 * The background job table (#1439): durable work a request hands off, claimed by any server task.
 */

import type { BackgroundJob, BackgroundJobRequest, BackgroundJobStatus } from '../domain';

export interface BackgroundJobRepository {
  /**
   * Queues one job, unless its dedupe key is already on a queued job; resolves to whether it was
   * written. For a job whose cause is written elsewhere, the adapter that writes the cause queues
   * it in the same transaction instead.
   */
  enqueue(request: BackgroundJobRequest): Promise<boolean>;
  /**
   * Claims up to `limit` due jobs, earliest due first: queued ones whose run time has come, and
   * running ones whose lease ended (their task stopped mid-run). Each becomes RUNNING with one
   * more attempt, leased until `leaseUntil`, and loses its dedupe key. Rows another task holds
   * are passed over, so two tasks never claim one job.
   */
  claimDue(claim: { now: Date; limit: number; leaseUntil: Date }): Promise<BackgroundJob[]>;
  /** SUCCEEDED at `completedAt`. */
  markSucceeded(id: string, completedAt: Date): Promise<void>;
  /** Back to QUEUED, due at `runAt`, keeping the error of the try that failed. */
  markRetry(id: string, retry: { runAt: Date; error: string }): Promise<void>;
  /** FAILED for good at `completedAt`. */
  markFailed(id: string, failed: { error: string; completedAt: Date }): Promise<void>;
  /**
   * Deletes up to `limit` jobs in `status` (SUCCEEDED or FAILED) completed before `cutoff`;
   * returns how many. One batch per call.
   */
  deleteBatchCompletedBefore(
    status: typeof BackgroundJobStatus.SUCCEEDED | typeof BackgroundJobStatus.FAILED,
    cutoff: Date,
    limit: number,
  ): Promise<number>;
}
