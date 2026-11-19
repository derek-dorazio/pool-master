import type { BackgroundJobResult } from '@poolmaster/shared/domain';

/**
 * What a handler answers for a try that did nothing worth a row in Activity (#1865): the job is
 * deleted instead of kept as SUCCEEDED.
 */
export const DISCARD_BACKGROUND_JOB: unique symbol = Symbol('discard background job');

/** What a handler's promise resolves to: a result to keep on the job, nothing, or that the job leaves no row. */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- most handlers are `Promise<void>` service calls; `undefined` in its place would make each of them return a value it has no use for.
export type BackgroundJobOutcome = BackgroundJobResult | void | typeof DISCARD_BACKGROUND_JOB;
