/**
 * The background job table (#1439): durable work a request hands off, claimed by any server task.
 */

import type { BackgroundJob, BackgroundJobRequest, BackgroundJobStatus } from '../domain';

/** One claim of a job: the job and the attempt the claim counted. */
export type BackgroundJobClaim = Pick<BackgroundJob, 'id' | 'attempts'>;

export interface BackgroundJobRepository {
  /**
   * Queues one job, unless a job waiting for its first try holds its dedupe key; resolves to whether it was
   * written. For a job whose cause is written elsewhere, the adapter that writes the cause queues
   * it in the same transaction instead.
   */
  enqueue(request: BackgroundJobRequest): Promise<boolean>;
  /**
   * Queues several jobs in one write, each skipped as `enqueue` skips one whose dedupe key a
   * waiting job holds; resolves to how many were written.
   */
  enqueueMany(requests: readonly BackgroundJobRequest[]): Promise<number>;
  /**
   * Claims up to `limit` due jobs, earliest due first: queued ones whose run time has come, and
   * running ones whose lease ended (their task stopped mid-run). Each becomes RUNNING with one
   * more attempt, leased until `leaseUntil`, and loses its dedupe key for good (a retry has none). Rows another task holds
   * are passed over, so two tasks never claim one job.
   */
  claimDue(claim: { now: Date; limit: number; leaseUntil: Date }): Promise<BackgroundJob[]>;
  /*
   * Each mark is fenced to the claim that ran the try: it writes only while the job is still
   * RUNNING on that attempt, and resolves to whether it did. A try that outran its lease was
   * claimed again elsewhere, so its late mark writes nothing over the newer attempt's.
   */
  /** SUCCEEDED at `completedAt`. */
  markSucceeded(claim: BackgroundJobClaim, completedAt: Date): Promise<boolean>;
  /** Back to QUEUED, due at `runAt`, keeping the error of the try that failed. */
  markRetry(claim: BackgroundJobClaim, retry: { runAt: Date; error: string }): Promise<boolean>;
  /** FAILED for good at `completedAt`. */
  markFailed(claim: BackgroundJobClaim, failed: { error: string; completedAt: Date }): Promise<boolean>;
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
