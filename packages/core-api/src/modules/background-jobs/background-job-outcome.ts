import type { BackgroundJobOutcome } from '@poolmaster/shared/domain';

/**
 * What a handler answers for a try that did nothing worth a row in Activity (#1865): the job is
 * deleted instead of kept as SUCCEEDED.
 */
export const DISCARD_BACKGROUND_JOB: unique symbol = Symbol('discard background job');

/** What a handler's promise resolves to: what it did, to keep on the job, or that the job leaves no row. */
export type BackgroundJobAnswer = BackgroundJobOutcome | typeof DISCARD_BACKGROUND_JOB;
