import { BackgroundJobType, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import { TEST_JOB_START } from './in-memory-background-jobs';
import type { LeaderboardRebuilds } from '../../packages/core-api/src/modules/contests/leaderboard-snapshots';

/** The rebuild job a write of an event's results carries: what the real handler names, for one event. */
export function eventRebuildJob(sportEventId: string): BackgroundJobRequest {
  return { ...rebuildJob('EVENT', sportEventId), sportEventId };
}

/** A contest's rebuild job, as a week submitted or sent back to draft writes it (#1466). */
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
 * Writes now carry their rebuild jobs through the domain event map (#1946), so this records only
 * the direct calls.
 */
export class RecordingLeaderboardRebuilds implements LeaderboardRebuilds {
  readonly sportEventIds: string[] = [];
  readonly contestIds: string[] = [];

  async eventsChanged(sportEventIds: readonly string[]): Promise<void> {
    this.sportEventIds.push(...sportEventIds);
  }


  async contestsChanged(contestIds: readonly string[]): Promise<void> {
    this.contestIds.push(...contestIds);
  }
}
