/**
 * YearOverYearTracker — tracks member improvement across seasons.
 *
 * Compares win rates, average finishes, and scores season-over-season
 * to surface improvement trends and rankings.
 */

import type { PrismaClient } from '@prisma/client';

export interface YearOverYearStats {
  memberId: string;
  memberName: string;
  sport: string;
  seasons: SeasonComparison[];
}

export interface SeasonComparison {
  season: string;
  year: number;
  contestsEntered: number;
  wins: number;
  avgFinishPosition: number;
  avgScore: number;
  bestFinish: number;
  winRate: number;
  deltaWinRate?: number;
  deltaAvgFinish?: number;
  deltaAvgScore?: number;
  trend: 'IMPROVING' | 'DECLINING' | 'STABLE' | 'NEW';
}

export interface ImprovementRanking {
  memberId: string;
  memberName: string;
  currentSeason: string;
  previousSeason: string;
  deltaWinRate: number;
  deltaAvgFinish: number;
  deltaAvgScore: number;
  overallImprovementScore: number;
}

export class YearOverYearTracker {
  constructor(private readonly prisma: PrismaClient) {}

  /** Get year-over-year stats for a member, optionally filtered by sport. */
  async getYoYStats(memberId: string, sport?: string): Promise<YearOverYearStats> {
    const where: Record<string, unknown> = { leagueMembershipId: memberId };
    if (sport) where.sport = sport;

    const results = await this.prisma.contestResult.findMany({
      where,
      orderBy: { closedAt: 'asc' },
    });

    const membership = await this.prisma.leagueMembership.findUnique({
      where: { id: memberId },
      include: { user: true },
    });
    const memberName = membership?.user.displayName ?? '';

    // Group results by season
    const bySeason = new Map<string, typeof results>();
    for (const r of results) {
      const key = r.seasonId ?? 'unknown';
      const existing = bySeason.get(key) ?? [];
      existing.push(r);
      bySeason.set(key, existing);
    }

    // Resolve season names and years
    const seasonIds = [...new Set(results.map((r) => r.seasonId).filter(Boolean))] as string[];
    const seasons = seasonIds.length > 0
      ? await this.prisma.season.findMany({ where: { id: { in: seasonIds } } })
      : [];
    const seasonMap = new Map(seasons.map((s) => [s.id, s]));

    // Build season comparisons sorted by year
    const comparisons: SeasonComparison[] = [];
    for (const [seasonId, seasonResults] of bySeason) {
      const season = seasonMap.get(seasonId);
      const contestsEntered = seasonResults.length;
      const wins = seasonResults.filter((r) => r.isWinner).length;
      const avgFinishPosition = seasonResults.reduce((s, r) => s + r.finalRank, 0) / contestsEntered;
      const avgScore = seasonResults.reduce((s, r) => s + r.totalScore, 0) / contestsEntered;
      const bestFinish = Math.min(...seasonResults.map((r) => r.finalRank));
      const winRate = contestsEntered > 0 ? wins / contestsEntered : 0;

      comparisons.push({
        season: season?.name ?? seasonId,
        year: season?.year ?? new Date().getFullYear(),
        contestsEntered,
        wins,
        avgFinishPosition: Math.round(avgFinishPosition * 100) / 100,
        avgScore: Math.round(avgScore * 100) / 100,
        bestFinish,
        winRate: Math.round(winRate * 1000) / 1000,
        trend: 'NEW',
      });
    }

    // Sort by year ascending
    comparisons.sort((a, b) => a.year - b.year);

    // Compute deltas and trends
    for (let i = 1; i < comparisons.length; i++) {
      const prev = comparisons[i - 1];
      const curr = comparisons[i];

      curr.deltaWinRate = Math.round((curr.winRate - prev.winRate) * 1000) / 1000;
      curr.deltaAvgFinish = Math.round((curr.avgFinishPosition - prev.avgFinishPosition) * 100) / 100;
      curr.deltaAvgScore = Math.round((curr.avgScore - prev.avgScore) * 100) / 100;

      curr.trend = determineTrend(curr.deltaWinRate, curr.deltaAvgFinish, curr.deltaAvgScore);
    }

    return {
      memberId,
      memberName,
      sport: sport ?? 'ALL',
      seasons: comparisons,
    };
  }

  /** Rank members by improvement from previous season to current season. */
  async getImprovementRankings(leagueId: string, season: string): Promise<ImprovementRanking[]> {
    // Find the target season
    const targetSeason = await this.prisma.leagueSeasonSummary.findFirst({
      where: { leagueId, seasonName: season },
    });

    if (!targetSeason) return [];

    // Get all results for this league
    const allResults = await this.prisma.contestResult.findMany({
      where: { leagueId },
      orderBy: { closedAt: 'asc' },
    });

    // Get memberships for names
    const memberships = await this.prisma.leagueMembership.findMany({
      where: { leagueId },
      include: { user: true },
    });
    const nameMap = new Map(memberships.map((m) => [m.id, m.user.displayName]));

    // Group by member then by season
    const byMember = new Map<string, Map<string, typeof allResults>>();
    for (const r of allResults) {
      if (!r.leagueMembershipId || !r.seasonId) continue;
      let memberSeasons = byMember.get(r.leagueMembershipId);
      if (!memberSeasons) {
        memberSeasons = new Map();
        byMember.set(r.leagueMembershipId, memberSeasons);
      }
      const existing = memberSeasons.get(r.seasonId) ?? [];
      existing.push(r);
      memberSeasons.set(r.seasonId, existing);
    }

    // Get all seasons sorted by year to find "previous"
    const seasonSummaries = await this.prisma.leagueSeasonSummary.findMany({
      where: { leagueId },
      orderBy: { year: 'asc' },
    });

    const targetIdx = seasonSummaries.findIndex((s) => s.seasonName === season);
    if (targetIdx <= 0) return [];

    const prevSeason = seasonSummaries[targetIdx - 1];
    const targetSeasonId = targetSeason.seasonId;
    const prevSeasonId = prevSeason.seasonId;

    if (!targetSeasonId || !prevSeasonId) return [];

    const rankings: ImprovementRanking[] = [];

    for (const [memberId, memberSeasons] of byMember) {
      const currResults = memberSeasons.get(targetSeasonId);
      const prevResults = memberSeasons.get(prevSeasonId);

      if (!currResults || !prevResults || currResults.length === 0 || prevResults.length === 0) continue;

      const currWinRate = currResults.filter((r) => r.isWinner).length / currResults.length;
      const prevWinRate = prevResults.filter((r) => r.isWinner).length / prevResults.length;
      const currAvgFinish = currResults.reduce((s, r) => s + r.finalRank, 0) / currResults.length;
      const prevAvgFinish = prevResults.reduce((s, r) => s + r.finalRank, 0) / prevResults.length;
      const currAvgScore = currResults.reduce((s, r) => s + r.totalScore, 0) / currResults.length;
      const prevAvgScore = prevResults.reduce((s, r) => s + r.totalScore, 0) / prevResults.length;

      const deltaWinRate = Math.round((currWinRate - prevWinRate) * 1000) / 1000;
      const deltaAvgFinish = Math.round((currAvgFinish - prevAvgFinish) * 100) / 100;
      const deltaAvgScore = Math.round((currAvgScore - prevAvgScore) * 100) / 100;

      // Composite improvement score: positive = improved
      const overallImprovementScore = Math.round(
        (deltaWinRate * 100) + (deltaAvgFinish * -10) + (deltaAvgScore * 0.1),
      ) / 100;

      rankings.push({
        memberId,
        memberName: nameMap.get(memberId) ?? '',
        currentSeason: season,
        previousSeason: prevSeason.seasonName,
        deltaWinRate,
        deltaAvgFinish,
        deltaAvgScore,
        overallImprovementScore,
      });
    }

    return rankings.sort((a, b) => b.overallImprovementScore - a.overallImprovementScore);
  }
}

function determineTrend(
  deltaWinRate: number,
  deltaAvgFinish: number,
  deltaAvgScore: number,
): 'IMPROVING' | 'DECLINING' | 'STABLE' {
  // Positive signals: higher win rate, lower finish position, higher score
  let positiveSignals = 0;
  let negativeSignals = 0;

  if (deltaWinRate > 0.02) positiveSignals++;
  else if (deltaWinRate < -0.02) negativeSignals++;

  if (deltaAvgFinish < -0.5) positiveSignals++;
  else if (deltaAvgFinish > 0.5) negativeSignals++;

  if (deltaAvgScore > 1) positiveSignals++;
  else if (deltaAvgScore < -1) negativeSignals++;

  if (positiveSignals >= 2) return 'IMPROVING';
  if (negativeSignals >= 2) return 'DECLINING';
  return 'STABLE';
}
