/**
 * StandingsRollup — pure rerank-and-publish helper for a single contest.
 *
 * pool-master-rop.78.8 — the periodic interval scheduler was retired
 * here. Per plans/117 §11.3 the substrate's single write path is
 * event-driven: `LiveScorePersistedEvent → LiveScoreConsumer →
 * scoring → contributions → totalScore → standingsRollup.rollupContest →
 * standings.updated`. The full-recalculation path
 * (ContestScoringRecalculationService) stays for explicit triggers
 * (admin override, contest reopen) but is no longer a parallel update
 * mechanism that races with stat-event scoring.
 *
 * The remaining surface is `rollupContest(contestId, options?)` —
 * called by the live-score consumer (golf-roster) and the explicit
 * recalculation path. `previousRanks` is kept so the per-contest
 * rerank can report `rankChanges` accurately across successive events.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { EventBus } from '@poolmaster/shared/events/event-bus';

// --- Types ---

/**
 * Direction in which `ContestEntry.totalScore` is ranked. Higher-is-better
 * is the default for the bulk of pool formats (BRACKET, PICKEM_CONFIDENCE,
 * SURVIVOR, basketball-roster, F1-position, etc.). Lower-is-better is used
 * by golf-roster, where `totalScore` is the sum of `scoreToPar`
 * contributions and the lowest total wins.
 */
export type RankDirection = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';

export interface RollupResult {
  contestId: string;
  entriesUpdated: number;
  rankChanges: number;
  rolledUpAt: Date;
}

export interface RollupContestOptions {
  /**
   * Override the per-contest rank direction. Defaults to
   * `'HIGHER_IS_BETTER'` to match the existing rollup contract for
   * non-golf contest types. Golf-roster callers (the live-score consumer
   * for golf, plus any future golf-roster recompute path) must pass
   * `'LOWER_IS_BETTER'` so an entry at -5 ranks ahead of an entry at +2.
   */
  rankDirection?: RankDirection;
}

export interface StandingEntry {
  entryId: string;
  rank: number;
  totalScore: number;
  isTied: boolean;
}

export interface StandingsRollupDeps {
  eventBus: EventBus;
  prisma: PrismaClient;
  logger?: FastifyBaseLogger;
}

// --- Rollup Class ---

/** Reads current totals, assigns ranks, and persists standings to ContestEntry. */
export class StandingsRollup {
  private previousRanks: Map<string, Map<string, number>> = new Map();
  private readonly eventBus: EventBus;
  private readonly prisma: PrismaClient;
  private readonly logger?: FastifyBaseLogger;

  constructor(deps: StandingsRollupDeps) {
    this.eventBus = deps.eventBus;
    this.prisma = deps.prisma;
    this.logger = deps.logger;
  }

  /** Run rollup for a specific contest. */
  async rollupContest(contestId: string, options?: RollupContestOptions): Promise<RollupResult> {
    const direction: RankDirection = options?.rankDirection ?? 'HIGHER_IS_BETTER';
    const totalScoreOrder = direction === 'LOWER_IS_BETTER' ? 'asc' : 'desc';
    const entries = await this.prisma.contestEntry.findMany({
      where: { contestId },
      orderBy: [{ totalScore: totalScoreOrder }, { id: 'asc' }],
      select: { id: true, totalScore: true },
    });
    const leaderboard = entries.map((entry) => ({
      entryId: entry.id,
      total: entry.totalScore,
    }));
    const standings = assignRanks(leaderboard);
    const rankChanges = this.countRankChanges(contestId, standings);
    this.updatePreviousRanks(contestId, standings);
    const rolledUpAt = new Date();

    await this.persistStandings(contestId, standings, rolledUpAt);

    await this.publishStandingsUpdated(contestId, standings, rolledUpAt);
    this.logger?.debug?.(
      { action: 'scoring.standings_rollup.rollup', data: { contestId, entriesUpdated: standings.length, rankChanges } },
      'Reranked contest standings',
    );
    return {
      contestId,
      entriesUpdated: standings.length,
      rankChanges,
      rolledUpAt,
    };
  }

  /** Persist standings positions onto ContestEntry. */
  private async persistStandings(
    contestId: string,
    standings: StandingEntry[],
    _rolledUpAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction(
      standings.map((s) =>
        this.prisma.contestEntry.update({
          where: { id: s.entryId },
          data: { standingsPosition: s.rank },
        }),
      ),
    );
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
