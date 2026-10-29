/**
 * The contest leaderboards this container computed in the last 30 seconds (#1162), so the
 * viewers polling an active contest every 30 seconds share one computation instead of each
 * reading every entry, pick and field row again. Per container, as every `ReadCache` is. A board
 * is computed from the event fields this container shares (#1163), and on a task other than the
 * one that ran the sync, a field can already be up to 30 seconds old when a board is computed
 * from it. So a viewer there can see a board up to about 60 seconds older than the latest sync,
 * then up to one poll more; on the task that ran it, up to 30 seconds and a poll.
 */
import type { ContestLeaderboardModel } from '../../mappers/contests.mapper';
import { READ_CACHE_TTL_MS, ReadCache, readCacheTtlMs } from '../../core/read-cache';

/** How long a computed leaderboard answers for its contest, unless the environment sets another. */
export const CONTEST_LEADERBOARD_CACHE_TTL_MS = READ_CACHE_TTL_MS;

/** The TTL from `CONTEST_LEADERBOARD_CACHE_TTL_MS`, in milliseconds, else 30 seconds; see `readCacheTtlMs`. */
export function readLeaderboardCacheTtlMs(env: NodeJS.ProcessEnv): number {
  return readCacheTtlMs(env, 'CONTEST_LEADERBOARD_CACHE_TTL_MS');
}

export class ContestLeaderboardCache {
  private readonly boards: ReadCache<ContestLeaderboardModel>;

  constructor(ttlMs: number = CONTEST_LEADERBOARD_CACHE_TTL_MS) {
    this.boards = new ReadCache(ttlMs);
  }

  /**
   * The contest's leaderboard for the shown event (`sportEventId`, or the latest revealed one
   * when undefined): the one computed within the TTL as of `now`, else `compute`'s, kept.
   */
  get(
    contestId: string,
    sportEventId: string | undefined,
    now: Date,
    compute: () => Promise<ContestLeaderboardModel>,
  ): Promise<ContestLeaderboardModel> {
    return this.boards.get(`${contestId}:${sportEventId ?? ''}`, now, compute);
  }
}
