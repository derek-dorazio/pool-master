/**
 * The job that runs the tiebreaker game rule for each slot of one event (#2048): its payload, the
 * request a write to the event's games makes, and the handlers that collect it. Its handler is
 * `SlotTiebreakerService.refresh`, which reads the slots and Games as they stand when the job runs.
 * The dedupe key holds one such job waiting per event, so a burst of score writes queues one.
 */

import { z } from 'zod';
import { BackgroundJobType, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import type { DomainEventType } from '../domain-events/domain-event';
import type { DomainEventHandler } from '../domain-events/domain-event-handler';

export const RefreshSlotTiebreakersJobPayloadSchema = z.object({
  sportEventId: z.string().min(1),
});
export type RefreshSlotTiebreakersJobPayload = z.infer<typeof RefreshSlotTiebreakersJobPayloadSchema>;

/** The job running the rule for the event's slots, due at once. */
export function refreshSlotTiebreakersJob(jobs: Pick<BackgroundJobQueue, 'request'>, sportEventId: string): BackgroundJobRequest {
  return jobs.request(BackgroundJobType.REFRESH_SLOT_TIEBREAKERS, { sportEventId }, {
    dedupeKey: `${BackgroundJobType.REFRESH_SLOT_TIEBREAKERS}:${sportEventId}`,
  });
}

/**
 * A load, a new time, a pairing or a move of an event's games can change which Game its slots'
 * rule chooses, so every such write carries the job that runs it again.
 */
export const refreshSlotTiebreakersHandler: DomainEventHandler<typeof DomainEventType.SPORT_EVENT_GAMES_CHANGED> = {
  key: 'refresh-slot-tiebreakers',
  queues: [BackgroundJobType.REFRESH_SLOT_TIEBREAKERS],
  jobs: (event, { queue }) => [refreshSlotTiebreakersJob(queue, event.sportEventId)],
};

/** A cancelled game cannot be a slot's tiebreaker, and a decided one is how a cancellation is told. */
export const refreshDecidedGameSlotTiebreakersHandler: DomainEventHandler<typeof DomainEventType.GAME_DECIDED> = {
  key: 'refresh-slot-tiebreakers-for-decided-game',
  queues: [BackgroundJobType.REFRESH_SLOT_TIEBREAKERS],
  jobs: (event, { queue }) => [refreshSlotTiebreakersJob(queue, event.sportEventId)],
};
