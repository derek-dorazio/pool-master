/**
 * StandingsRollup — periodic job that reads totals from ScoreStore
 * and writes ranked standings to the SQL ContestStanding table.
 *
 * v1: logs standings and publishes events. Production will write to Prisma.
 */

import type { EventBus } from '@poolmaster/shared/events/event-bus';
import type { ScoreStore } from '../storage/score-store';

// --- Types ---

export interface RollupResult {
  contestId: string;
  entriesUpdated: number;
  rankChanges: number;
  rolledUpAt: Date;
}

export interface StandingEntry {
  entryId: string;
  rank: number;
  totalScore: number;
  isTied: boolean;
}

export interface StandingsRollupDeps {
  eventBus: EventBus;
  scoreStore: ScoreStore;
}

// --- Rollup Class ---

const DEFAULT_INTERVAL_MS = 30_000;

/** Reads ScoreStore leaderboards, assigns ranks, and publishes standings updates. */
export class StandingsRollup {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private activeContestIds: Set<string> = new Set();
  private previousRanks: Map<string, Map<string, number>> = new Map();
  private readonly eventBus: EventBus;
  private readonly scoreStore: ScoreStore;

  constructor(deps: StandingsRollupDeps) {
    this.eventBus = deps.eventBus;
    this.scoreStore = deps.scoreStore;
  }

  /** Register a contest for periodic rollup. */
  registerContest(contestId: string): void {
    this.activeContestIds.add(contestId);
  }

  /** Unregister a contest from periodic rollup. */
  unregisterContest(contestId: string): void {
    this.activeContestIds.delete(contestId);
    this.previousRanks.delete(contestId);
  }

  /** Run rollup for a specific contest. */
  async rollupContest(contestId: string): Promise<RollupResult> {
    const leaderboard = await this.scoreStore.getLeaderboard(contestId);
    const standings = assignRanks(leaderboard);
    const rankChanges = this.countRankChanges(contestId, standings);
    this.updatePreviousRanks(contestId, standings);
    const rolledUpAt = new Date();
    await this.publishStandingsUpdated(contestId, standings, rolledUpAt);
    return {
      contestId,
      entriesUpdated: standings.length,
      rankChanges,
      rolledUpAt,
    };
  }

  /** Run rollup for all registered active contests. */
  async rollupAll(): Promise<RollupResult[]> {
    const results: RollupResult[] = [];
    for (const contestId of this.activeContestIds) {
      const result = await this.rollupContest(contestId);
      results.push(result);
    }
    return results;
  }

  /** Start periodic rollup at the given interval. */
  startPeriodicRollup(intervalMs: number = DEFAULT_INTERVAL_MS): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      this.rollupAll().catch((err) => {
        console.error('[StandingsRollup] periodic rollup failed:', err);
      });
    }, intervalMs);
  }

  /** Stop periodic rollup. */
  stopPeriodicRollup(): void {
    if (!this.intervalHandle) return;
    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  /** Check if periodic rollup is running. */
  isRunning(): boolean {
    return this.intervalHandle !== null;
  }

  /** Get the set of active contest IDs. */
  getActiveContestIds(): ReadonlySet<string> {
    return this.activeContestIds;
  }

  /** Count how many entries changed rank since last rollup. */
  private countRankChanges(contestId: string, standings: StandingEntry[]): number {
    const previous = this.previousRanks.get(contestId);
    if (!previous) return standings.length;
    let changes = 0;
    for (const entry of standings) {
      const previousRank = previous.get(entry.entryId);
      if (previousRank === undefined || previousRank !== entry.rank) {
        changes++;
      }
    }
    return changes;
  }

  /** Store current ranks for comparison on next rollup. */
  private updatePreviousRanks(contestId: string, standings: StandingEntry[]): void {
    const rankMap = new Map<string, number>();
    for (const entry of standings) {
      rankMap.set(entry.entryId, entry.rank);
    }
    this.previousRanks.set(contestId, rankMap);
  }

  /** Publish standings.updated event. */
  private async publishStandingsUpdated(
    contestId: string,
    standings: StandingEntry[],
    rolledUpAt: Date,
  ): Promise<void> {
    await this.eventBus.publish('standings.updated', {
      id: `standings-${contestId}-${Date.now()}`,
      type: 'standings.updated',
      sourceService: 'scoring-service',
      timestamp: rolledUpAt.toISOString(),
      tenantId: '',
      contestId,
      standings: standings.map((s) => ({
        entryId: s.entryId,
        rank: s.rank,
        totalScore: s.totalScore,
        isTied: s.isTied,
      })),
    });
  }
}

/** Assign ranks to a sorted leaderboard, handling ties (same score = same rank). */
export function assignRanks(
  leaderboard: { entryId: string; total: number }[],
): StandingEntry[] {
  if (leaderboard.length === 0) return [];
  const standings: StandingEntry[] = [];
  let currentRank = 1;
  for (let i = 0; i < leaderboard.length; i++) {
    const entry = leaderboard[i];
    const previousEntry = i > 0 ? leaderboard[i - 1] : null;
    const isTied = previousEntry !== null && entry.total === previousEntry.total;
    if (!isTied && i > 0) {
      currentRank = i + 1;
    }
    standings.push({
      entryId: entry.entryId,
      rank: currentRank,
      totalScore: entry.total,
      isTied,
    });
  }
  return standings;
}
