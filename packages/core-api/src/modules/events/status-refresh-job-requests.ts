/**
 * The jobs that carry status up from Matches to Season slots to the event (#2013, #1953): their
 * payloads, the requests, and the handlers that collect them. Each recomputes its target as it
 * stands when the job runs, and writes only a status that moved. The dedupe key holds one job
 * waiting per event, so a burst of score writes queues one of each.
 */

import { z } from 'zod';
import { BackgroundJobType, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import type { DomainEventType } from '../domain-events/domain-event';
import type { DomainEventHandler } from '../domain-events/domain-event-handler';

export const RefreshStatusJobPayloadSchema = z.object({
  sportEventId: z.string().min(1),
});

function refreshJob(
  jobs: Pick<BackgroundJobQueue, 'request'>,
  type: typeof BackgroundJobType.REFRESH_SLOT_STATUS | typeof BackgroundJobType.REFRESH_EVENT_STATUS,
  sportEventId: string,
): BackgroundJobRequest {
  return jobs.request(type, { sportEventId }, { dedupeKey: `${type}:${sportEventId}` });
}

/** A Match that moved can move its slot: the event's slots are refreshed. */
export const refreshSlotStatusHandler: DomainEventHandler<typeof DomainEventType.MATCH_STATUS_CHANGED> = {
  key: 'refresh-slot-status',
  queues: [BackgroundJobType.REFRESH_SLOT_STATUS],
  jobs: (event, { queue }) => [refreshJob(queue, BackgroundJobType.REFRESH_SLOT_STATUS, event.sportEventId)],
};

/** A slot that moved can move its event: the event's status is refreshed. */
export const refreshEventStatusHandler: DomainEventHandler<typeof DomainEventType.SEASON_SLOT_STATUS_CHANGED> = {
  key: 'refresh-event-status',
  queues: [BackgroundJobType.REFRESH_EVENT_STATUS],
  jobs: (event, { queue }) => [refreshJob(queue, BackgroundJobType.REFRESH_EVENT_STATUS, event.sportEventId)],
};
