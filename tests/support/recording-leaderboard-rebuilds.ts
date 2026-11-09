import type { LeaderboardRebuilds } from '../../packages/core-api/src/modules/contests/leaderboard-snapshots';

/** Records what each write told the leaderboard rebuilds (#1435), in place of rebuilding anything. */
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
