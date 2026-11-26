import { BackgroundJobType, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import { TEST_JOB_START } from './in-memory-background-jobs';

/** The job a write of an event's games, or a decided game, carries to run its slots' tiebreaker rule again (#2048). */
export function slotTiebreakersRefreshJob(sportEventId: string): BackgroundJobRequest {
  return {
    type: BackgroundJobType.REFRESH_SLOT_TIEBREAKERS,
    payload: { sportEventId },
    sportEventId,
    runAt: undefined,
    start: TEST_JOB_START,
    dedupeKey: `${BackgroundJobType.REFRESH_SLOT_TIEBREAKERS}:${sportEventId}`,
  };
}
