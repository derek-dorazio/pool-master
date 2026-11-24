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
import type { DomainEventType } from '../domain-events/domain-event';
import type { DomainEventHandler } from '../domain-events/domain-event-handler';

export const SettleGameContestsJobPayloadSchema = z.object({
  sportEventId: z.string().min(1),
  sportEventRoundMatchId: z.string().min(1),
  /** When the contests settle: the moment the game was decided. */
  completedAt: z.iso.datetime(),
});
export type SettleGameContestsJobPayload = z.infer<typeof SettleGameContestsJobPayloadSchema>;

/**
 * The job for one game just decided. Its dedupe key holds one such job per game still waiting for
 * its first try, so a result saved and then corrected before it runs queues one; the job reads the
 * game as it then stands, and settles at the first save's time. A game whose result was cleared
 * before the job runs settles nothing.
 */
export function settleGameContestsJob(
  jobs: Pick<BackgroundJobQueue, 'request'>,
  sportEventId: string,
  sportEventRoundMatchId: string,
  completedAt: Date,
): BackgroundJobRequest {
  return jobs.request(BackgroundJobType.SETTLE_GAME_CONTESTS, { sportEventId, sportEventRoundMatchId, completedAt: completedAt.toISOString() }, {
    dedupeKey: `${BackgroundJobType.SETTLE_GAME_CONTESTS}:${sportEventRoundMatchId}`,
  });
}

/**
 * The squares contests played on a decided game settle now, while its event may have weeks to run
 * (#711), in a job written with the game, so a request never loops over an event's contests. An
 * admin's result and a provider's queue it alike (#1954).
 */
export const settleDecidedGameContestsHandler: DomainEventHandler<typeof DomainEventType.GAME_DECIDED> = {
  key: 'settle-decided-game-contests',
  queues: [BackgroundJobType.SETTLE_GAME_CONTESTS],
  jobs: (event, { queue }) => [settleGameContestsJob(queue, event.sportEventId, event.sportEventRoundMatchId, event.decidedAt)],
};
