/**
 * LeagueHistoryService — league season summaries, all-time member stats,
 * leaderboards, champion lists, and trophy cases.
 */

import type { PrismaClient } from '@prisma/client';

// --- Response types ---

export interface SeasonChampion {
  contestId: string;
  contestName: string;
  entryId: string;
  entryName: string;
  memberId: string;
  memberName: string;
  finalScore: number;
  prizeWon?: number;
}

export interface MemberAllTimeStats {
  leagueMembershipId: string;
  memberDisplayName: string;
  totalContests: number;
  totalWins: number;
  totalRunnerUp: number;
  totalTop3: number;
  totalPaidPositions: number;
  winRate: number;
  paidRate: number;
  totalPointsScored: number;
  avgPointsPerContest: number;
  highestScore?: { score: number; contestName: string; contestId: string };
  lowestScore?: { score: number; contestName: string; contestId: string };
  totalEntryFeesPaid: number;
  totalPrizesWon: number;
  netWinnings: number;
  avgPercentileRank: number;
}

export interface AllTimeLeaderboardEntry {
  rank: number;
  leagueMembershipId: string;
  memberDisplayName: string;
  contestsWon: number;
  winRate: number;
  totalPoints: number;
  avgPointsPerContest: number;
  netWinnings: number;
  totalContests: number;
}

export class LeagueHistoryService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Returns all season summaries for a league. */
  async getSeasonSummaries(leagueId: string) {
    return this.prisma.leagueSeasonSummary.findMany({
      where: { leagueId },
      orderBy: { year: 'desc' },
    });
  }

  /** Returns a specific season summary. */
  async getSeasonSummary(leagueId: string, seasonId: string) {
    return this.prisma.leagueSeasonSummary.findUnique({
      where: { leagueId_seasonId: { leagueId, seasonId } },
    });
  }

  /** Aggregates and upserts a season summary from contest results. */
  async aggregateSeasonSummary(
    leagueId: string,
    seasonId: string,
    seasonName: string,
    sport?: string,
    year?: number,
  ) {
    const results = await this.prisma.contestResult.findMany({
      where: { leagueId, seasonId },
      orderBy: { finalRank: 'asc' },
    });

    const entries = await this.prisma.contestEntry.findMany({
      where: { contestId: { in: [...new Set(results.map((r) => r.contestId))] } },
    });
    const entryNameMap = new Map(entries.map((e) => [e.id, e.name]));

    const memberships = await this.prisma.leagueMembership.findMany({
      where: { leagueId },
      include: { user: true },
    });
    const memberNameMap = new Map(
      memberships.map((m) => [m.id, m.user.displayName]),
    );

    // Find champions (rank 1) per contest
    const champions: SeasonChampion[] = [];
    const contestIds = [...new Set(results.map((r) => r.contestId))];

    for (const contestId of contestIds) {
      const winner = results.find((r) => r.contestId === contestId && r.isWinner);
      if (winner) {
        champions.push({
          contestId,
          contestName: winner.contestName ?? '',
          entryId: winner.entryId,
          entryName: entryNameMap.get(winner.entryId) ?? '',
          memberId: winner.leagueMembershipId ?? '',
          memberName: memberNameMap.get(winner.leagueMembershipId ?? '') ?? '',
          finalScore: winner.totalScore,
          prizeWon: winner.prizeAmount ?? undefined,
        });
      }
    }

    const uniqueMembers = new Set(results.map((r) => r.leagueMembershipId).filter(Boolean));
    const totalPrizePool = results.reduce((sum, r) => sum + (r.prizeAmount ?? 0), 0);

    // Highlights
    const allScores = results.map((r) => r.totalScore);
    const highlights = {
      highestScore: Math.max(...allScores),
      lowestScore: Math.min(...allScores),
    };

    return this.prisma.leagueSeasonSummary.upsert({
      where: { leagueId_seasonId: { leagueId, seasonId } },
      create: {
        leagueId,
        seasonId,
        seasonName,
        sport,
        year,
        numMembers: uniqueMembers.size,
        numContests: contestIds.length,
        totalPrizePool,
        champions: champions as unknown as object,
        highlights: highlights as unknown as object,
      },
      update: {
        seasonName,
        numMembers: uniqueMembers.size,
        numContests: contestIds.length,
        totalPrizePool,
        champions: champions as unknown as object,
        highlights: highlights as unknown as object,
      },
    });
  }

  /** Returns all-time champion list for a league (winner of each contest). */
  async getChampionList(leagueId: string): Promise<SeasonChampion[]> {
    const winners = await this.prisma.contestResult.findMany({
      where: { leagueId, isWinner: true },
      orderBy: { closedAt: 'desc' },
    });

    const entries = await this.prisma.contestEntry.findMany({
      where: { id: { in: winners.map((w) => w.entryId) } },
    });
    const entryNameMap = new Map(entries.map((e) => [e.id, e.name]));

    const memberships = await this.prisma.leagueMembership.findMany({
      where: { leagueId },
      include: { user: true },
    });
    const memberNameMap = new Map(
      memberships.map((m) => [m.id, m.user.displayName]),
    );

    return winners.map((w) => ({
      contestId: w.contestId,
      contestName: w.contestName ?? '',
      entryId: w.entryId,
      entryName: entryNameMap.get(w.entryId) ?? '',
      memberId: w.leagueMembershipId ?? '',
      memberName: memberNameMap.get(w.leagueMembershipId ?? '') ?? '',
      finalScore: w.totalScore,
      prizeWon: w.prizeAmount ?? undefined,
    }));
  }

  /** Computes all-time stats for a specific league member. */
  async getMemberStats(leagueMembershipId: string): Promise<MemberAllTimeStats | null> {
    const results = await this.prisma.contestResult.findMany({
      where: { leagueMembershipId },
      orderBy: { closedAt: 'desc' },
    });

    if (results.length === 0) return null;

    const membership = await this.prisma.leagueMembership.findUnique({
      where: { id: leagueMembershipId },
      include: { user: true },
    });

    const totalContests = results.length;
    const totalWins = results.filter((r) => r.isWinner).length;
    const totalRunnerUp = results.filter((r) => r.finalRank === 2).length;
    const totalTop3 = results.filter((r) => r.finalRank <= 3).length;
    const totalPaidPositions = results.filter((r) => r.isPaidPosition).length;
    const totalPointsScored = results.reduce((sum, r) => sum + r.totalScore, 0);
    const totalEntryFeesPaid = results.reduce((sum, r) => sum + (r.entryFeePaid ?? 0), 0);
    const totalPrizesWon = results.reduce((sum, r) => sum + (r.prizeAmount ?? 0), 0);

    const sortedByScore = [...results].sort((a, b) => b.totalScore - a.totalScore);
    const percentiles = results.map((r) => r.percentileRank ?? 0);
    const avgPercentile = percentiles.length > 0
      ? percentiles.reduce((sum, p) => sum + p, 0) / percentiles.length
      : 0;

    return {
      leagueMembershipId,
      memberDisplayName: membership?.user.displayName ?? '',
      totalContests,
      totalWins,
      totalRunnerUp,
      totalTop3,
      totalPaidPositions,
      winRate: totalContests > 0 ? totalWins / totalContests : 0,
      paidRate: totalContests > 0 ? totalPaidPositions / totalContests : 0,
      totalPointsScored,
      avgPointsPerContest: totalContests > 0 ? totalPointsScored / totalContests : 0,
      highestScore: sortedByScore[0]
        ? { score: sortedByScore[0].totalScore, contestName: sortedByScore[0].contestName ?? '', contestId: sortedByScore[0].contestId }
        : undefined,
      lowestScore: sortedByScore.length > 0
        ? { score: sortedByScore[sortedByScore.length - 1].totalScore, contestName: sortedByScore[sortedByScore.length - 1].contestName ?? '', contestId: sortedByScore[sortedByScore.length - 1].contestId }
        : undefined,
      totalEntryFeesPaid,
      totalPrizesWon,
      netWinnings: totalPrizesWon - totalEntryFeesPaid,
      avgPercentileRank: avgPercentile,
    };
  }

  /** Computes the all-time leaderboard for a league. */
  async getAllTimeLeaderboard(
    leagueId: string,
    sortBy: 'WINS' | 'POINTS' | 'WINNINGS' = 'WINS',
  ): Promise<AllTimeLeaderboardEntry[]> {
    const results = await this.prisma.contestResult.findMany({
      where: { leagueId },
    });

    const memberships = await this.prisma.leagueMembership.findMany({
      where: { leagueId },
      include: { user: true },
    });

    // Group results by membership
    const byMember = new Map<string, typeof results>();
    for (const r of results) {
      if (!r.leagueMembershipId) continue;
      const existing = byMember.get(r.leagueMembershipId) ?? [];
      existing.push(r);
      byMember.set(r.leagueMembershipId, existing);
    }

    const entries: AllTimeLeaderboardEntry[] = [];
    for (const membership of memberships) {
      const memberResults = byMember.get(membership.id) ?? [];
      if (memberResults.length === 0) continue;

      const totalContests = memberResults.length;
      const contestsWon = memberResults.filter((r) => r.isWinner).length;
      const totalPoints = memberResults.reduce((sum, r) => sum + r.totalScore, 0);
      const totalPrizes = memberResults.reduce((sum, r) => sum + (r.prizeAmount ?? 0), 0);
      const totalFees = memberResults.reduce((sum, r) => sum + (r.entryFeePaid ?? 0), 0);

      entries.push({
        rank: 0, // assigned after sorting
        leagueMembershipId: membership.id,
        memberDisplayName: membership.user.displayName,
        contestsWon,
        winRate: totalContests > 0 ? contestsWon / totalContests : 0,
        totalPoints,
        avgPointsPerContest: totalContests > 0 ? totalPoints / totalContests : 0,
        netWinnings: totalPrizes - totalFees,
        totalContests,
      });
    }

    // Sort
    entries.sort((a, b) => {
      switch (sortBy) {
        case 'WINS': return b.contestsWon - a.contestsWon || b.winRate - a.winRate;
        case 'POINTS': return b.totalPoints - a.totalPoints;
        case 'WINNINGS': return b.netWinnings - a.netWinnings;
      }
    });

    // Assign ranks
    entries.forEach((e, i) => { e.rank = i + 1; });

    return entries;
  }

  /** Returns all trophies for a league member. */
  async getMemberTrophies(leagueId: string, leagueMembershipId: string) {
    return this.prisma.trophy.findMany({
      where: { leagueId, leagueMembershipId, isDisplayed: true },
      orderBy: { awardedAt: 'desc' },
    });
  }

  /** Awards trophies based on contest results. Call after contest close. */
  async awardContestTrophies(leagueId: string, contestId: string): Promise<number> {
    const results = await this.prisma.contestResult.findMany({
      where: { leagueId, contestId },
      orderBy: { finalRank: 'asc' },
    });

    let awarded = 0;
    const now = new Date();

    for (const result of results) {
      if (!result.leagueMembershipId) continue;

      if (result.isWinner) {
        await this.prisma.trophy.create({
          data: {
            leagueId,
            leagueMembershipId: result.leagueMembershipId,
            trophyType: 'LEAGUE_CHAMPION',
            contestId,
            seasonId: result.seasonId,
            label: `${result.contestName ?? 'Contest'} Champion`,
            description: `Won with ${result.totalScore} points`,
            awardedAt: now,
          },
        });
        awarded++;
      }

      if (result.finalRank === 2) {
        await this.prisma.trophy.create({
          data: {
            leagueId,
            leagueMembershipId: result.leagueMembershipId,
            trophyType: 'RUNNER_UP',
            contestId,
            seasonId: result.seasonId,
            label: `${result.contestName ?? 'Contest'} Runner-Up`,
            awardedAt: now,
          },
        });
        awarded++;
      }

      if (result.finalRank === 3) {
        await this.prisma.trophy.create({
          data: {
            leagueId,
            leagueMembershipId: result.leagueMembershipId,
            trophyType: 'TOP_3_FINISH',
            contestId,
            seasonId: result.seasonId,
            label: `${result.contestName ?? 'Contest'} 3rd Place`,
            awardedAt: now,
          },
        });
        awarded++;
      }

      if (result.isPaidPosition && result.finalRank > 3) {
        await this.prisma.trophy.create({
          data: {
            leagueId,
            leagueMembershipId: result.leagueMembershipId,
            trophyType: 'PAID_POSITION',
            contestId,
            seasonId: result.seasonId,
            label: `${result.contestName ?? 'Contest'} — Paid Finish (#${result.finalRank})`,
            awardedAt: now,
          },
        });
        awarded++;
      }
    }

    return awarded;
  }
}
