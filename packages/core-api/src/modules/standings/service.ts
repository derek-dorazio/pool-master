/**
 * StandingsService — leaderboard queries, rank summaries, and user entry lookups.
 *
 * Reads from ContestEntry to produce paginated leaderboards with owner details.
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

  private async fetchEnrichedStandings(contestId: string): Promise<StandingEntry[]> {
    const entries = await this.prisma.contestEntry.findMany({
      where: { contestId },
      include: {
        squad: {
          include: {
            memberships: {
              where: { status: 'ACTIVE' },
              include: { user: true },
              orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
      orderBy: [
        { standingsPosition: 'asc' },
        { totalScore: 'desc' },
        { createdAt: 'asc' },
      ],
    });

    if (entries.length === 0) {
      throw new StandingsError(
        'Standings have not been generated for this contest yet',
        'STANDINGS_UNAVAILABLE',
        409,
      );
    }

    const rankedEntries = assignRanksFromEntries(entries);

    return rankedEntries.map(({ entry, rank }) => {
      const ownerMembership = entry.squad.memberships[0];
      return {
        rank,
        previousRank: entry.standingsPosition ?? null,
        movement: computeMovement(rank, entry.standingsPosition ?? null),
        entryId: entry.id,
        entryName: entry?.name ?? 'Unknown',
        ownerDisplayName: ownerMembership?.user?.displayName ?? entry?.squad.name ?? 'Unknown',
        ownerId: ownerMembership?.user?.id ?? '',
        totalScore: entry.totalScore,
        isEliminated: entry?.isEliminated ?? false,
        lastUpdatedAt: entry.updatedAt,
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

function assignRanksFromEntries(
  entries: Array<{
    id: string;
    totalScore: number;
    standingsPosition: number | null;
    createdAt: Date;
    updatedAt: Date;
    name: string;
    isEliminated: boolean;
    squad: {
      name: string;
      memberships: Array<{
        user: {
          id: string;
          displayName: string;
        };
      }>;
    };
  }>,
) {
  const sorted = [...entries].sort((a, b) => {
    if ((a.standingsPosition ?? Number.MAX_SAFE_INTEGER) !== (b.standingsPosition ?? Number.MAX_SAFE_INTEGER)) {
      return (a.standingsPosition ?? Number.MAX_SAFE_INTEGER) - (b.standingsPosition ?? Number.MAX_SAFE_INTEGER);
    }
    if (a.totalScore !== b.totalScore) {
      return b.totalScore - a.totalScore;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  let currentRank = 1;
  return sorted.map((entry, index) => {
    if (index > 0 && entry.totalScore !== sorted[index - 1]!.totalScore) {
      currentRank = index + 1;
    }
    return {
      entry,
      rank: entry.standingsPosition ?? currentRank,
    };
  });
}
