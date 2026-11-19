import { AsyncLocalStorage } from 'node:async_hooks';
import { JobTrigger, type JobStart } from '@poolmaster/shared/domain';

/**
 * What started the work in progress (#1861), so every background job it queues records it. Each
 * entry point opens one scope and everything under it shares it, however deep the service that
 * queues the job:
 *
 * - a request: ADMIN or COMMISSIONER, the role its route requires, with the signed-in person,
 *   once the gates have run; SYSTEM for upkeep a member's request asks for;
 * - the provider webhook receiver: WEBHOOK;
 * - a timed sweep or the sync scheduler: SCHEDULE;
 * - a background job's handler: SYSTEM, for the jobs it queues in turn.
 *
 * A job queued under none of these has no honest trigger, so queueing it throws
 * (`JobStartMissingError`) rather than guessing one.
 */
type JobStartSource = () => JobStart | undefined;

const scope = new AsyncLocalStorage<JobStartSource>();

/** Runs `work` with `start` as what started it, over any scope it is called in. */
export function runWithJobStart<T>(start: JobStart, work: () => T): T {
  return scope.run(() => start, work);
}

/**
 * Runs `work` under a request's scope: its start is read when a job is queued, as `source`
 * answers then, since the person is known only once the auth guard has run.
 */
export function runWithJobStartSource<T>(source: JobStartSource, work: () => T): T {
  return scope.run(source, work);
}

/** A job was queued with no entry point having said what started it. */
export class JobStartMissingError extends Error {
  constructor() {
    super('A background job was queued outside any request, webhook, sweep or job, so nothing says what started it');
    this.name = 'JobStartMissingError';
  }
}

/** What started the work in progress; throws when nothing opened a scope that says. */
export function currentJobStart(): JobStart {
  const start = scope.getStore()?.();
  if (start === undefined) throw new JobStartMissingError();
  return start;
}

/** The start a timed sweep or scheduler records. */
export const SCHEDULE_START: JobStart = { trigger: JobTrigger.SCHEDULE };
/** The start the provider webhook receiver records. */
export const WEBHOOK_START: JobStart = { trigger: JobTrigger.WEBHOOK };
/** The start a job's handler records for the jobs it queues. */
export const SYSTEM_START: JobStart = { trigger: JobTrigger.SYSTEM };
