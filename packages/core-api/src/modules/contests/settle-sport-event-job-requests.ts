/**
 * The job that settles a finished event's contests (#1448): its payload and the request the
 * event's status change writes in its transaction. Settling an event can mean hundreds of
 * contests, so it runs in the background, never in the request that finished the event. Its
 * handler is EventLifecycleService.settleFinishedEventContests, which sends a cancellation's C7
 * email and then settles through ContestSettlementService.settleFinishedSportEvent.
 */

import { z } from 'zod';
import { BackgroundJobType, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';

export const SettleSportEventContestsJobPayloadSchema = z.object({
  sportEventId: z.string().min(1),
  /** When the contests settle: the event's end, or the moment it was cancelled. */
  completedAt: z.iso.datetime(),
});
export type SettleSportEventContestsJobPayload = z.infer<typeof SettleSportEventContestsJobPayloadSchema>;

/**
 * The job for one event that just completed or was cancelled. Its dedupe key holds one such job
 * per event still waiting for its first try, so moving the event out and back before it runs
 * queues nothing more; the job reads the event again and settles only if it is still finished.
 */
export function settleSportEventContestsJob(
  jobs: Pick<BackgroundJobQueue, 'request'>,
  sportEventId: string,
  completedAt: Date,
): BackgroundJobRequest {
  return jobs.request(BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS, { sportEventId, completedAt: completedAt.toISOString() }, {
    dedupeKey: `${BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS}:${sportEventId}`,
  });
}
