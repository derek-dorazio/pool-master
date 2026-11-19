/**
 * The background job table (#1439): durable work a request hands off, claimed by any server task.
 */

import type {
  BackgroundJob,
  BackgroundJobActivityFilter,
  BackgroundJobOutcome,
  BackgroundJobRequest,
  BackgroundJobStatus,
  JobErrorType,
} from '../domain';

/** One claim of a job: the job and the attempt the claim counted. */
export type BackgroundJobClaim = Pick<BackgroundJob, 'id' | 'attempts'>;

export interface BackgroundJobRepository {
  /**
   * Queues one job, unless a job waiting for its first try holds its dedupe key; resolves to whether it was
   * written. For a job whose cause is written elsewhere, the adapter that writes the cause queues
   * it in the same transaction instead.
   */
  enqueue(request: BackgroundJobRequest): Promise<boolean>;
  /** Queues several jobs in one write, each unless a waiting job holds its dedupe key; resolves to how many were written. */
  enqueueAll(requests: readonly BackgroundJobRequest[]): Promise<number>;
  /**
   * Queues one job and answers it, for a caller that shows the job it queued (an admin's Sync
   * now, #1819). When a job waiting for its first try holds the dedupe key, answers that job.
   */
  enqueueReturning(request: BackgroundJobRequest): Promise<BackgroundJob>;
  /**
   * Claims up to `limit` due jobs, earliest due first: queued ones whose run time has come, and
   * running ones whose lease ended (their task stopped mid-run). Each becomes RUNNING with one
   * more attempt, started at `now` (#1861), leased until `leaseUntil`, and loses its dedupe key for good (a retry has none). Rows another task holds
   * are passed over, so two tasks never claim one job.
   */
  claimDue(claim: { now: Date; limit: number; leaseUntil: Date }): Promise<BackgroundJob[]>;
  /*
   * Each mark is fenced to the claim that ran the try: it writes only while the job is still
   * RUNNING on that attempt, and resolves to whether it did. A try that outran its lease was
   * claimed again elsewhere, so its late mark writes nothing over the newer attempt's.
   */
  /**
   * SUCCEEDED at `completedAt`, with what its handler reported it did (#1819, #1861): the rows it
   * changed, a hold, and its result. An earlier try's error type goes unless the outcome is a hold.
   */
  markSucceeded(claim: BackgroundJobClaim, completedAt: Date, outcome: BackgroundJobOutcome): Promise<boolean>;
  /**
   * Holds a long try's claim until `leaseUntil` (#1819), so no other task claims the job while
   * it is still working; false when the claim is no longer this try's.
   */
  renewLease(claim: BackgroundJobClaim, leaseUntil: Date): Promise<boolean>;
  /** Back to QUEUED, due at `runAt`, keeping the error of the try that failed and its type (#1861). */
  markRetry(claim: BackgroundJobClaim, retry: { runAt: Date; error: string; errorType: JobErrorType }): Promise<boolean>;
  /**
   * Deletes the job its try ran, leaving no row (#1865): for a try that did nothing worth showing
   * in Activity, such as a release check that held an event for the same reason as before.
   */
  deleteClaimed(claim: BackgroundJobClaim): Promise<boolean>;
  /** FAILED for good at `completedAt`, with its error and its type (#1861). */
  markFailed(claim: BackgroundJobClaim, failed: { error: string; errorType: JobErrorType; completedAt: Date }): Promise<boolean>;
  /**
   * Deletes up to `limit` jobs in `status` (SUCCEEDED or FAILED) completed before `cutoff`;
   * returns how many. One batch per call.
   */
  deleteBatchCompletedBefore(
    status: typeof BackgroundJobStatus.SUCCEEDED | typeof BackgroundJobStatus.FAILED,
    cutoff: Date,
    limit: number,
  ): Promise<number>;
  /**
   * Activity (#1819): the jobs created inside the filter's window that match it, newest first,
   * in a fixed number of reads however many there are, each with the person who started it
   * (#1861). Nothing pages it.
   */
  findActivity(filter: BackgroundJobActivityFilter): Promise<BackgroundJob[]>;
}
