import { BackgroundJobType, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { JobsForWrite } from '../../packages/core-api/src/modules/background-jobs';
import type { LeaderboardRebuilds } from '../../packages/core-api/src/modules/contests/leaderboard-snapshots';

/** The rebuild job a recording `forEvent` hands a write: what the real one names, for one event. */
export function eventRebuildJob(sportEventId: string): BackgroundJobRequest {
  return {
    type: BackgroundJobType.REBUILD_LEADERBOARDS,
    payload: { subject: 'EVENT', id: sportEventId },
    dedupeKey: `${BackgroundJobType.REBUILD_LEADERBOARDS}:EVENT:${sportEventId}`,
  };
}

/**
 * Records what each write told the leaderboard rebuilds (#1435), in place of rebuilding anything.
 * A write carrying its rebuild (`forEvent`, #1466) is recorded only once it calls `queued()`,
 * that is once the write has committed; `handedOut` is every event whose job a write was given.
 */
export class RecordingLeaderboardRebuilds implements LeaderboardRebuilds {
  readonly sportEventIds: string[] = [];
  readonly contestIds: string[] = [];
  readonly handedOut: string[] = [];

  async eventsChanged(sportEventIds: readonly string[]): Promise<void> {
    this.sportEventIds.push(...sportEventIds);
  }

  async contestsChanged(contestIds: readonly string[]): Promise<void> {
    this.contestIds.push(...contestIds);
  }

  forEvent(sportEventId: string): JobsForWrite {
    this.handedOut.push(sportEventId);
    return { jobs: [eventRebuildJob(sportEventId)], queued: () => { this.sportEventIds.push(sportEventId); } };
  }
}
