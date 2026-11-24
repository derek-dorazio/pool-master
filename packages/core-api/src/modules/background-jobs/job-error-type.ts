/**
 * What kind of failure a job's error is (#1861), for Activity's Error column. An error that knows
 * its own kind says so with `jobErrorType` (a provider client's request error, a contract
 * mismatch); otherwise its cause chain is read, a timed-out request or a schema failure is
 * recognised by name, and anything else is OTHER.
 */

import { JobErrorType } from '@poolmaster/shared/domain';

/** An error that knows which kind of job failure it is. */
export interface ClassifiedJobError {
  readonly jobErrorType: JobErrorType;
}

/** The names an aborted or timed-out fetch raises. */
const TIMEOUT_ERROR_NAMES = new Set(['AbortError', 'TimeoutError']);
/** The cause chain is read this deep at most, so a cycle of causes cannot loop. */
const MAX_CAUSE_DEPTH = 10;

/** The kind of an HTTP status a provider answered with. */
export function jobErrorTypeOfStatus(status: number): JobErrorType {
  return status === 429 ? JobErrorType.RATE_LIMITED : JobErrorType.PROVIDER_ERROR;
}

export function jobErrorTypeOf(error: unknown): JobErrorType {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (isClassified(current)) return current.jobErrorType;
    if (TIMEOUT_ERROR_NAMES.has(current.name)) return JobErrorType.TIMEOUT;
    if (current.name === 'ZodError') return JobErrorType.BAD_DATA;
    current = current.cause;
  }
  return JobErrorType.OTHER;
}

function isClassified(error: Error): error is Error & ClassifiedJobError {
  const kind = (error as Partial<ClassifiedJobError>).jobErrorType;
  return typeof kind === 'string' && kind in JobErrorType;
}

/**
 * An error that says its job should simply run again later (league model slice 1c), such as a
 * provider rate limiting the call: the job is queued again for `deferUntil`, and the try does not
 * count toward its attempts.
 */
export interface DeferredJobError {
  readonly deferUntil: Date;
}

/** When the error, or an error in its cause chain, asks for its job to run again; null if none does. */
export function jobDeferredUntilOf(error: unknown): Date | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    const deferUntil = (current as Partial<DeferredJobError>).deferUntil;
    if (deferUntil instanceof Date) return deferUntil;
    current = current.cause;
  }
  return null;
}
