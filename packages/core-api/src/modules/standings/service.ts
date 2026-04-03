/**
 * StandingsService — leaderboard queries, rank summaries, and user entry lookups.
 *
 * Reads from the ContestStanding and ContestEntry repositories to produce
 * paginated leaderboards with movement indicators and owner details.
 */

import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StandingEntry {
  rank: number;
  previousRank: number | null;
  movement: 'up' | 'down' | 'same' | 'new';
  entryId: string;
  entryName: string;
  ownerDisplayName: string;
  ownerId: string;
  totalScore: number;
  isEliminated: boolean;
  lastUpdatedAt: Date;
}

export interface StandingsPage {
  standings: StandingEntry[];
  total: number;
  page: number;
  pageSize: number;
  contestId: string;
}

export interface StandingsSummary {
  topEntries: StandingEntry[];
  totalEntries: number;
  contestId: string;
}

export interface MyEntryResult {
  entry: StandingEntry;
  totalEntries: number;
  contestId: string;
}

export type SortField = 'rank' | 'score' | 'name';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class StandingsError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'StandingsError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class StandingsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Returns a paginated leaderboard for a contest.
   */
  async getStandings(
    contestId: string,
    options: { page?: number; pageSize?: number; sortBy?: SortField } = {},
  ): Promise<StandingsPage> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
    const sortBy = options.sortBy ?? 'rank';

    const entries = await this.fetchEnrichedStandings(contestId);
    const sorted = sortEntries(entries, sortBy);
    const total = sorted.length;
    const start = (page - 1) * pageSize;
    const pageEntries = sorted.slice(start, start + pageSize);

    return { standings: pageEntries, total, page, pageSize, contestId };
  }

  /**
   * Returns the top N entries for a dashboard summary widget.
   */
  async getSummary(contestId: string, topN: number = 5): Promise<StandingsSummary> {
    const entries = await this.fetchEnrichedStandings(contestId);
    const sorted = sortEntries(entries, 'rank');

    return {
      topEntries: sorted.slice(0, topN),
      totalEntries: sorted.length,
      contestId,
    };
  }

  /**
   * Returns the current user's entry with rank context.
   */
  async getMyEntry(contestId: string, userId: string): Promise<MyEntryResult> {
    const entries = await this.fetchEnrichedStandings(contestId);

    const myEntry = entries.find((e) => e.ownerId === userId);
    if (!myEntry) {
      throw new StandingsError(
        'You do not have an entry in this contest',
        'ENTRY_NOT_FOUND',
        404,
      );
    }

    return {
      entry: myEntry,
      totalEntries: entries.length,
      contestId,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Fetches contest standings joined with entry and user data.
   * Computes movement indicators by comparing current rank with the
   * rank stored on the ContestEntry (treated as the previous snapshot).
   */
  private async fetchEnrichedStandings(contestId: string): Promise<StandingEntry[]> {
    // Fetch standings with entry and membership/user details
    const standings = await this.prisma.contestStanding.findMany({
      where: { contestId },
      orderBy: { rank: 'asc' },
    });

    if (standings.length === 0) {
      throw new StandingsError(
        'Standings have not been generated for this contest yet',
        'STANDINGS_UNAVAILABLE',
        409,
      );
    }

    // Fetch all entries for this contest with their owner info
    const entries = await this.prisma.contestEntry.findMany({
      where: { contestId },
      include: {
        membership: {
          include: { user: true },
        },
      },
    });

    const entryMap = new Map(entries.map((e) => [e.id, e]));

    return standings.map((s) => {
      const entry = entryMap.get(s.entryId);
      const previousRank = entry?.rank ?? null;
      const movement = computeMovement(s.rank, previousRank);

      return {
        rank: s.rank,
        previousRank,
        movement,
        entryId: s.entryId,
        entryName: entry?.name ?? 'Unknown',
        ownerDisplayName: entry?.membership?.user?.displayName ?? 'Unknown',
        ownerId: entry?.membership?.user?.id ?? '',
        totalScore: s.totalScore,
        isEliminated: entry?.isEliminated ?? false,
        lastUpdatedAt: s.lastUpdatedAt,
      };
    });
  }

}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeMovement(
  currentRank: number,
  previousRank: number | null,
): 'up' | 'down' | 'same' | 'new' {
  if (previousRank === null) return 'new';
  if (currentRank < previousRank) return 'up';
  if (currentRank > previousRank) return 'down';
  return 'same';
}

function sortEntries(entries: StandingEntry[], sortBy: SortField): StandingEntry[] {
  const sorted = [...entries];
  switch (sortBy) {
    case 'rank':
      sorted.sort((a, b) => a.rank - b.rank);
      break;
    case 'score':
      sorted.sort((a, b) => b.totalScore - a.totalScore);
      break;
    case 'name':
      sorted.sort((a, b) => a.entryName.localeCompare(b.entryName));
      break;
  }
  return sorted;
}
