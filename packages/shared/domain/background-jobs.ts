import type { BackgroundJobStatus, BackgroundJobType } from './enums';

/**
 * One background job (#1439): durable work a request handed off, run by whichever server task
 * claims it. Its payload is checked against its type's schema when it is queued and again when
 * it runs.
 */
export interface BackgroundJob {
  id: string;
  type: BackgroundJobType;
  /** The job's input, as stored: JSON its type's schema reads. */
  payload: unknown;
  status: BackgroundJobStatus;
  /** When it is due: first queued, or retried after a failed try. */
  runAt: Date;
  /** Tries so far, counting the one in progress. */
  attempts: number;
  /** While RUNNING, until when the claiming task holds it; past this it is due again. */
  leaseUntil?: Date;
  /** The error of the last failed try. */
  lastError?: string;
  createdAt: Date;
  /** When it SUCCEEDED or FAILED. */
  completedAt?: Date;
}

/**
 * A job to queue, its payload already checked against its type's schema. A `dedupeKey` already
 * on a queued job queues nothing: one pending job per subject. The key is released when the job
 * is claimed, so a request made while it runs queues a fresh one.
 */
export interface BackgroundJobRequest {
  type: BackgroundJobType;
  payload: unknown;
  /** Due at once when omitted. */
  runAt?: Date;
  dedupeKey?: string;
}
