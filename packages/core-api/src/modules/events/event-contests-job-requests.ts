/**
 * The jobs that move an event's contests when the event's status moves (#1952): going live when
 * the event starts, and a postponed event's contests following its start (reopened while it is
 * ahead, live once it has passed, #1792). Each is written with the event's status change, so a
 * task that stops after the change still moves them; until #1952 both ran inline after the write.
 * The lifecycle sweep still asks the same questions of every event in progress or postponed, as the
 * backstop. Their handlers are `EventLifecycleService.activateEventContests` and
 * `EventLifecycleService.followPostponedEventContests`, which read the event again.
 */

import { z } from 'zod';
import { BackgroundJobType, SeasonSlotStatus, SportEventStatus, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import type { DomainEventType } from '../domain-events/domain-event';
import type { DomainEventHandler } from '../domain-events/domain-event-handler';

export const EventContestsJobPayloadSchema = z.object({
  sportEventId: z.string().min(1),
});
export type EventContestsJobPayload = z.infer<typeof EventContestsJobPayloadSchema>;

/**
 * One job per event waiting for its first try: a second start of the event before it runs queues
 * nothing more, and the waiting job reads the event as it then stands.
 */
function eventContestsJob(
  jobs: Pick<BackgroundJobQueue, 'request'>,
  type: typeof BackgroundJobType.ACTIVATE_EVENT_CONTESTS | typeof BackgroundJobType.FOLLOW_POSTPONED_EVENT_CONTESTS,
  sportEventId: string,
): BackgroundJobRequest {
  return jobs.request(type, { sportEventId }, { dedupeKey: `${type}:${sportEventId}` });
}

/** An event that starts takes its contests live at their cutoffs (#721), by this job written with the status. */
export const activateEventContestsHandler: DomainEventHandler<typeof DomainEventType.SPORT_EVENT_STATUS_CHANGED> = {
  key: 'activate-event-contests',
  queues: [BackgroundJobType.ACTIVATE_EVENT_CONTESTS],
  when: (event) => event.to === SportEventStatus.IN_PROGRESS,
  jobs: (event, { queue }) => [eventContestsJob(queue, BackgroundJobType.ACTIVATE_EVENT_CONTESTS, event.sportEvent.id)],
};

/**
 * A slot that starts takes the contests covering it live (#2013): a contest's cutoff is its first
 * covered Game, so a contest on a later slot of an event already under way goes live when that slot
 * starts, not when the event did. The same job as the event's start, deduplicated with it.
 */
export const activateSlotContestsHandler: DomainEventHandler<typeof DomainEventType.SEASON_SLOT_STATUS_CHANGED> = {
  key: 'activate-slot-contests',
  queues: [BackgroundJobType.ACTIVATE_EVENT_CONTESTS],
  when: (event) => event.from === SeasonSlotStatus.SCHEDULED,
  jobs: (event, { queue }) => [eventContestsJob(queue, BackgroundJobType.ACTIVATE_EVENT_CONTESTS, event.sportEventId)],
};

/**
 * A postponed event's contests follow its start (#1792): reopened while it is ahead, live once it
 * has passed. A repeated postponement asks again, as the lifecycle sweep does.
 */
export const followPostponedEventContestsHandler: DomainEventHandler<typeof DomainEventType.SPORT_EVENT_STATUS_CHANGED> = {
  key: 'follow-postponed-event-contests',
  queues: [BackgroundJobType.FOLLOW_POSTPONED_EVENT_CONTESTS],
  when: (event) => event.to === SportEventStatus.POSTPONED,
  jobs: (event, { queue }) => [eventContestsJob(queue, BackgroundJobType.FOLLOW_POSTPONED_EVENT_CONTESTS, event.sportEvent.id)],
};
