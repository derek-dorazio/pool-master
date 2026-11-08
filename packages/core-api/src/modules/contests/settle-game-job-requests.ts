/**
 * The job that settles the squares contests played on one game once the game is decided: its
 * result is in, a quarter score a contest waited for is entered after it, or the game was
 * cancelled (#711). The match write that decides the game writes it in its transaction. Its
 * handler is EventLifecycleService.settleFinishedGameContests, which settles through
 * ContestSettlementService.settleFinishedGame.
 */

import { z } from 'zod';
import { BackgroundJobType, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';

export const SettleGameContestsJobPayloadSchema = z.object({
  sportEventId: z.string().min(1),
  sportEventMatchId: z.string().min(1),
  /** When the contests settle: the moment the game was decided. */
  completedAt: z.iso.datetime(),
});
export type SettleGameContestsJobPayload = z.infer<typeof SettleGameContestsJobPayloadSchema>;

/**
 * The job for one game just decided. Its dedupe key holds one such job per game still waiting for
 * its first try, so a result saved and then corrected before it runs queues one; the job reads the
 * game as it then stands.
 */
export function settleGameContestsJob(
  jobs: Pick<BackgroundJobQueue, 'request'>,
  sportEventId: string,
  sportEventMatchId: string,
  completedAt: Date,
): BackgroundJobRequest {
  return jobs.request(BackgroundJobType.SETTLE_GAME_CONTESTS, { sportEventId, sportEventMatchId, completedAt: completedAt.toISOString() }, {
    dedupeKey: `${BackgroundJobType.SETTLE_GAME_CONTESTS}:${sportEventMatchId}`,
  });
}
