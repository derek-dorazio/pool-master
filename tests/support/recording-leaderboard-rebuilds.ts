import { BackgroundJobType, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import { TEST_JOB_START } from './in-memory-background-jobs';
import type { JobsForWrite } from '../../packages/core-api/src/modules/background-jobs';
import type { LeaderboardRebuilds } from '../../packages/core-api/src/modules/contests/leaderboard-snapshots';

/** The rebuild job a write of an event's results carries: what the real handler names, for one event. */
export function eventRebuildJob(sportEventId: string): BackgroundJobRequest {
  return { ...rebuildJob('EVENT', sportEventId), sportEventId };
}

/** The rebuild job a recording `forContest` hands a write, for one contest. */
export function contestRebuildJob(contestId: string): BackgroundJobRequest {
  return rebuildJob('CONTEST', contestId);
}

function rebuildJob(subject: 'EVENT' | 'CONTEST', id: string): BackgroundJobRequest {
  return {
    type: BackgroundJobType.REBUILD_LEADERBOARDS,
    payload: { subject, id },
    dedupeKey: `${BackgroundJobType.REBUILD_LEADERBOARDS}:${subject}:${id}`,
    start: TEST_JOB_START,
  };
}

/**
 * Records what each write told the leaderboard rebuilds (#1435), in place of rebuilding anything.
 * A write carrying its rebuild (`forContest`, #1466) is recorded only once it calls `queued()`,
 * that is once the write has committed; `handedOut` is every contest whose job a write was given.
 */
export class RecordingLeaderboardRebuilds implements LeaderboardRebuilds {
  readonly sportEventIds: string[] = [];
  readonly contestIds: string[] = [];
  readonly handedOut: string[] = [];

  async eventsChanged(sportEventIds: readonly string[]): Promise<void> {
    this.sportEventIds.push(...sportEventIds);
  }

  forContest(contestId: string): JobsForWrite {
    this.handedOut.push(contestId);
    return { jobs: [contestRebuildJob(contestId)], queued: () => { this.contestIds.push(contestId); } };
  }

  async contestsChanged(contestIds: readonly string[]): Promise<void> {
    this.contestIds.push(...contestIds);
  }
}
