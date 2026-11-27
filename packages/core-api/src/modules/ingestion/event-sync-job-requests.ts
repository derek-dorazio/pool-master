/**
 * The event sync jobs' requests (#2009): what a SYNC_EVENT_FIELD or SYNC_EVENT_SCORES job carries,
 * and the one builder of either for a write. Kept apart from the jobs that run them, so the job
 * payload registry can read the schema without the runner's imports.
 */

import { z } from 'zod';
import {
  BackgroundJobType,
  ProviderSyncKind,
  type BackgroundJobRequest,
  type JobStart,
  type ProviderCode,
} from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import type { EventSyncKind } from './core/sync-orchestrator';

/** An event sync job's payload: the event, and the run a root admin's Sync now submitted for it. */
export const EventSyncJobPayloadSchema = z.object({
  sportEventId: z.uuid(),
  /** The SUBMITTED run this job runs (Sync now, #1441); absent, the job records a run of its own. */
  syncRunId: z.uuid().optional(),
});
export type EventSyncJobPayload = z.infer<typeof EventSyncJobPayloadSchema>;

/** Each event sync kind's job type. */
export const EVENT_SYNC_JOB_TYPES = {
  [ProviderSyncKind.FIELD]: BackgroundJobType.SYNC_EVENT_FIELD,
  [ProviderSyncKind.SCORES]: BackgroundJobType.SYNC_EVENT_SCORES,
} as const satisfies Record<EventSyncKind, BackgroundJobType>;

/**
 * Which waiting job of an event's kind a request joins: one queued on the schedule or a webhook's
 * coalesced sync (SYNC), or a webhook's reconciling sync after a game ends (RECONCILE, #1499),
 * which waits apart so the coalesced one never swallows it.
 */
export const EventSyncWait = {
  SYNC: 'SYNC',
  RECONCILE: 'RECONCILE',
} as const;
export type EventSyncWait = (typeof EventSyncWait)[keyof typeof EventSyncWait];

/**
 * One event sync job, built for a write. A Sync now's job (`syncRunId`) holds no dedupe key, since
 * each runs the runs its admin submitted; any other holds one waiting job per event, kind and wait,
 * keyed by our own ids.
 */
export function eventSyncJob(
  jobs: Pick<BackgroundJobQueue, 'request'>,
  kind: EventSyncKind,
  payload: EventSyncJobPayload,
  options: { start: JobStart; providerCode: ProviderCode; runAt?: Date; wait?: EventSyncWait },
): BackgroundJobRequest {
  const type = EVENT_SYNC_JOB_TYPES[kind];
  const dedupeKey = payload.syncRunId === undefined
    ? `${type}:${options.wait ?? EventSyncWait.SYNC}:${payload.sportEventId}`
    : undefined;
  return jobs.request(type, payload, {
    start: options.start,
    providerCode: options.providerCode,
    ...(options.runAt !== undefined && { runAt: options.runAt }),
    ...(dedupeKey !== undefined && { dedupeKey }),
  });
}
