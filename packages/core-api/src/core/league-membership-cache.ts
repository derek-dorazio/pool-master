/**
 * The callers' league memberships this task read lately (#1438), so the access check that
 * nearly every league request makes is not one database read per request. Per task: each API
 * task keeps its own, kept for a TTL (30 seconds unless `LEAGUE_MEMBERSHIP_CACHE_TTL_MS` sets
 * another).
 *
 * Only an ACTIVE membership is kept. "Not a member" (no row, or a row that is not active) is
 * never kept, so a user turned away who then joins is let in on their very next request, on
 * whichever task answers it. The staleness this allows runs one way only: after a removal or a
 * role change made on another task, this task can go on granting the old access for up to one
 * TTL. A membership write this task makes forgets the entry here at once.
 *
 * A write runs inside `writing`: while one is under way, and for any read that started before
 * it finished, nothing read is kept, so a read that saw the row before the write committed
 * cannot put the old membership back.
 *
 * Kept values are shared between callers: treat them as read-only.
 */
import type { LeagueMembership } from '@poolmaster/shared/domain';
import { LeagueMembershipStatus } from '@poolmaster/shared/domain';
import { readCacheTtlMs } from './read-cache';

/** The TTL from `LEAGUE_MEMBERSHIP_CACHE_TTL_MS`, in milliseconds, else 30 seconds; see `readCacheTtlMs`. */
export function readLeagueMembershipCacheTtlMs(env: NodeJS.ProcessEnv): number {
  return readCacheTtlMs(env, 'LEAGUE_MEMBERSHIP_CACHE_TTL_MS');
}

interface KeptMembership {
  expiresAt: number;
  membership: LeagueMembership;
}

export class LeagueMembershipCache {
  private readonly kept = new Map<string, KeptMembership>();
  /** Writes under way: while any is, nothing read is kept. */
  private writesUnderWay = 0;
  /** Bumped as each write finishes: a read that started before then is not kept. */
  private writesFinished = 0;
  private nextSweepAt = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The membership kept for `leagueId` and `userId`, else `load`'s, kept only when ACTIVE. */
  async read(
    leagueId: string,
    userId: string,
    load: () => Promise<LeagueMembership | null>,
  ): Promise<LeagueMembership | null> {
    const key = keyOf(leagueId, userId);
    const startedAt = this.now().getTime();
    const hit = this.kept.get(key);
    if (hit && hit.expiresAt > startedAt) {
      return hit.membership;
    }
    if (hit) this.kept.delete(key);

    const writesFinishedBefore = this.writesFinished;
    const membership = await load();
    if (
      this.ttlMs > 0
      && membership?.status === LeagueMembershipStatus.ACTIVE
      && this.writesUnderWay === 0
      && this.writesFinished === writesFinishedBefore
    ) {
      this.sweepExpired(startedAt);
      this.kept.set(key, { expiresAt: startedAt + this.ttlMs, membership });
    }
    return membership;
  }

  /**
   * Runs a membership write. Nothing is kept while it runs, and every read that started before
   * it finished is not kept either, whether or not the write succeeded.
   */
  async writing<T>(write: () => Promise<T>): Promise<T> {
    this.writesUnderWay += 1;
    try {
      return await write();
    } finally {
      this.writesUnderWay -= 1;
      this.writesFinished += 1;
    }
  }

  /** Drops the membership kept for `leagueId` and `userId`: a write to it calls this. */
  forget(leagueId: string, userId: string): void {
    this.kept.delete(keyOf(leagueId, userId));
  }

  /** Drops every membership kept in `leagueId`, for a write that reaches them all, such as deleting it. */
  forgetLeague(leagueId: string): void {
    const prefix = `${leagueId}:`;
    for (const key of this.kept.keys()) {
      if (key.startsWith(prefix)) this.kept.delete(key);
    }
  }

  /** Forgets every membership past its TTL, at most once a TTL, so the map holds only recent callers. */
  private sweepExpired(at: number): void {
    if (at < this.nextSweepAt) return;
    this.nextSweepAt = at + this.ttlMs;
    for (const [key, kept] of this.kept) {
      if (kept.expiresAt <= at) this.kept.delete(key);
    }
  }
}

function keyOf(leagueId: string, userId: string): string {
  return `${leagueId}:${userId}`;
}

/** This task's cache, which every league membership repository reads through unless given another. */
export const leagueMembershipCache = new LeagueMembershipCache(readLeagueMembershipCacheTtlMs(process.env));
