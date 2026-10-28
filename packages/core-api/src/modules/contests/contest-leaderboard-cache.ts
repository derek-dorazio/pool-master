/**
 * The contest leaderboards this container computed in the last 30 seconds (#1162), so the
 * viewers polling an active contest every 30 seconds share one computation instead of each
 * reading every entry, pick and field row again. Per container: each API task keeps its own, so
 * a viewer can see a board up to 30 seconds older than the latest sync, then up to one poll more.
 *
 * A computation in flight is shared too: a second viewer asking while the first one's board is
 * being computed waits for it rather than starting another. A computation that fails is not
 * kept, so the next viewer asks again.
 */
import type { ContestLeaderboardModel } from '../../mappers/contests.mapper';

/** How long a computed leaderboard answers for its contest, unless the environment sets another. */
export const CONTEST_LEADERBOARD_CACHE_TTL_MS = 30_000;

/**
 * The TTL from `CONTEST_LEADERBOARD_CACHE_TTL_MS`, in milliseconds, else 30 seconds. 0 keeps no
 * board past its computation, as the functional API lane runs, where a test reads a board right
 * after the write it checks. Anything but a whole number of 0 or more refuses to start.
 */
export function readLeaderboardCacheTtlMs(env: NodeJS.ProcessEnv): number {
  const raw = env['CONTEST_LEADERBOARD_CACHE_TTL_MS'];
  if (raw === undefined || raw === '') return CONTEST_LEADERBOARD_CACHE_TTL_MS;
  const ttlMs = Number(raw);
  if (!Number.isInteger(ttlMs) || ttlMs < 0) {
    throw new Error(`CONTEST_LEADERBOARD_CACHE_TTL_MS must be a whole number of milliseconds, 0 or more; got "${raw}"`);
  }
  return ttlMs;
}

interface CachedLeaderboard {
  expiresAt: number;
  board: Promise<ContestLeaderboardModel>;
}

export class ContestLeaderboardCache {
  private readonly boards = new Map<string, CachedLeaderboard>();

  constructor(private readonly ttlMs: number = CONTEST_LEADERBOARD_CACHE_TTL_MS) {}

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
    const at = now.getTime();
    const key = `${contestId}:${sportEventId ?? ''}`;
    const cached = this.boards.get(key);
    if (cached && cached.expiresAt > at) {
      return cached.board;
    }
    this.dropExpired(at);
    const board = compute();
    const entry = { expiresAt: at + this.ttlMs, board };
    this.boards.set(key, entry);
    board.catch(() => {
      if (this.boards.get(key) === entry) this.boards.delete(key);
    });
    return board;
  }

  /** Forgets every board past its TTL, so the cache holds only the contests viewed lately. */
  private dropExpired(at: number): void {
    for (const [key, cached] of this.boards) {
      if (cached.expiresAt <= at) this.boards.delete(key);
    }
  }
}
