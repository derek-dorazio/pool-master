/**
 * A domain event handler (#1946): what one kind of follow-up to a change is. A handler only
 * collects background job requests. It may read, but it never writes, sends email or calls
 * another module's write; the writer puts the jobs it collects in its own transaction.
 */

import type { BackgroundJobRequest, BackgroundJobType } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import type { SportEventChangedNotice } from '../notifications/contest-notices';
import type { DomainEventOf, DomainEventType } from './domain-event';

/**
 * What handlers read and build their jobs with, each one required: built once where the app is
 * built (`index.ts`), so a missing wire fails typecheck rather than queue nothing.
 */
export interface DomainEventHandlerContext {
  queue: Pick<BackgroundJobQueue, 'request'>;
  /** The contests told an event was moved or cancelled (#1458, #1464). */
  sportEventChanged: Pick<SportEventChangedNotice, 'sportEventChangedJobs'>;
}

export interface DomainEventHandler<T extends DomainEventType> {
  /** Names the handler in the pinned map and the generated job table: stable, kebab-case. */
  key: string;
  /** Every job type the handler may queue; the job table in docs/BACKGROUND-JOBS.md is generated from it. */
  queues: readonly BackgroundJobType[];
  /** Whether the event calls for it, from the event's own model fields; omitted, every event does. */
  when?: (event: DomainEventOf<T>) => boolean;
  jobs: (event: DomainEventOf<T>, context: DomainEventHandlerContext) => Promise<readonly BackgroundJobRequest[]> | readonly BackgroundJobRequest[];
}

/** The handlers of every event type, in the order their jobs are collected. */
export type DomainEventHandlerMap = { readonly [T in DomainEventType]: readonly DomainEventHandler<T>[] };
