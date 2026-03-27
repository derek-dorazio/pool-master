/**
 * AnalyticsEngine — luck scores, power ratings, consistency,
 * year-over-year improvement, and analytics-based trophy awards.
 *
 * All computations are derived from ContestResult records.
 * Pure functions where possible; database access only for input/output.
 */

import type { PrismaClient } from '@prisma/client';

// --- Luck Score (All-Play Method) ---

export interface LuckScoreResult {
  leagueMembershipId: string;
  memberName: string;
  actualWins: number;
  expectedWins: number;
  luckScore: number;
  luckPercentile: number;
}

/**
 * Computes luck scores using the all-play method.
 *
 * For each contest a member enters, we calculate how many other
 * entrants they would have beaten (all-play wins). The expected
 * win count is the sum of all-play win rates. Luck = actual wins - expected.
 */
export function computeAllPlayLuck(
  memberResults: Array<{
    leagueMembershipId: string;
    contestId: string;
    totalScore: number;
    isWinner: boolean;
  }>,
): Map<string, { actualWins: number; expectedWins: number; luckScore: number }> {
  // Group by contest
  const byContest = new Map<string, typeof memberResults>();
  for (const r of memberResults) {
    const existing = byContest.get(r.contestId) ?? [];
    existing.push(r);
    byContest.set(r.contestId, existing);
  }

  // For each member, compute expected wins across all contests
  const memberStats = new Map<string, { actualWins: number; expectedWins: number }>();

  for (const [_contestId, contestResults] of byContest) {
    const n = contestResults.length;
    if (n < 2) continue;

    for (const entry of contestResults) {
      const allPlayWins = contestResults.filter(
        (other) => other.leagueMembershipId !== entry.leagueMembershipId &&
          entry.totalScore > other.totalScore,
      ).length;

      const allPlayWinRate = allPlayWins / (n - 1);

      const existing = memberStats.get(entry.leagueMembershipId) ?? { actualWins: 0, expectedWins: 0 };
      existing.expectedWins += allPlayWinRate;
      if (entry.isWinner) existing.actualWins++;
      memberStats.set(entry.leagueMembershipId, existing);
    }
  }

  const result = new Map<string, { actualWins: number; expectedWins: number; luckScore: number }>();
  for (const [memberId, stats] of memberStats) {
    result.set(memberId, {
      actualWins: stats.actualWins,
      expectedWins: Math.round(stats.expectedWins * 100) / 100,
      luckScore: Math.round((stats.actualWins - stats.expectedWins) * 100) / 100,
    });
  }

  return result;
}

// --- Power Rating (Oberon Mountain Method) ---

export interface PowerRatingResult {
  leagueMembershipId: string;
  memberName: string;
  avgScore: number;
  highScore: number;
  lowScore: number;
  winPct: number;
  rawPowerRating: number;
  adjustedPowerRating: number;
}

/**
 * Computes the Oberon Mountain Power Rating.
 *
 * Formula: Raw = ((avg × 6) + ((high + low) × 2) + (winPct × 200 × 2)) / 10
 * Adjusted = raw / leagueAverageRaw
 */
export function computePowerRatings(
  memberScores: Map<string, { scores: number[]; wins: number; totalContests: number }>,
): Map<string, { rawPowerRating: number; avgScore: number; highScore: number; lowScore: number; winPct: number }> {
  const ratings = new Map<string, { rawPowerRating: number; avgScore: number; highScore: number; lowScore: number; winPct: number }>();

  for (const [memberId, data] of memberScores) {
    if (data.scores.length === 0) continue;

    const avgScore = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
    const highScore = Math.max(...data.scores);
    const lowScore = Math.min(...data.scores);
    const winPct = data.totalContests > 0 ? data.wins / data.totalContests : 0;

    const rawPowerRating = (
      (avgScore * 6) +
      ((highScore + lowScore) * 2) +
      (winPct * 200 * 2)
    ) / 10;

    ratings.set(memberId, { rawPowerRating, avgScore, highScore, lowScore, winPct });
  }

  return ratings;
}

// --- Consistency Score ---

export interface ConsistencyResult {
  leagueMembershipId: string;
  meanPercentile: number;
  stdDevPercentile: number;
  consistencyScore: number;
  consistencyLabel: string;
}

export function computeConsistency(
  percentileRanks: number[],
): { meanPercentile: number; stdDevPercentile: number; consistencyScore: number; consistencyLabel: string } {
  if (percentileRanks.length < 2) {
    return { meanPercentile: 50, stdDevPercentile: 0, consistencyScore: 100, consistencyLabel: 'Insufficient Data' };
  }

  const mean = percentileRanks.reduce((a, b) => a + b, 0) / percentileRanks.length;
  const variance = percentileRanks.reduce((sum, p) => sum + (p - mean) ** 2, 0) / percentileRanks.length;
  const stdDev = Math.sqrt(variance);
  const consistencyScore = Math.max(0, 100 - stdDev);

  let consistencyLabel: string;
  if (consistencyScore >= 85) consistencyLabel = 'Very Consistent';
  else if (consistencyScore >= 70) consistencyLabel = 'Consistent';
  else if (consistencyScore >= 50) consistencyLabel = 'Streaky';
  else consistencyLabel = 'Volatile';

  return { meanPercentile: Math.round(mean * 10) / 10, stdDevPercentile: Math.round(stdDev * 10) / 10, consistencyScore: Math.round(consistencyScore * 10) / 10, consistencyLabel };
}

// --- Analytics Service (orchestrates computations) ---

export class AnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Computes luck scores for all members in a league. */
  async computeLuckScores(leagueId: string): Promise<LuckScoreResult[]> {
    const results = await this.prisma.contestResult.findMany({
      where: { leagueId },
    });

    const memberships = await this.prisma.leagueMembership.findMany({
      where: { leagueId },
      include: { user: true },
    });
    const nameMap = new Map(memberships.map((m: any) => [m.id, m.user.displayName]));

    const luckMap = computeAllPlayLuck(
      results
        .filter((r: any) => r.leagueMembershipId)
        .map((r: any) => ({
          leagueMembershipId: r.leagueMembershipId!,
          contestId: r.contestId,
          totalScore: r.totalScore,
          isWinner: r.isWinner,
        })),
    );

    // Compute percentiles
    const luckScores = Array.from(luckMap.entries()).map(([memberId, stats]) => stats.luckScore);
    const sortedLuck = [...luckScores].sort((a, b) => a - b);

    return Array.from(luckMap.entries()).map(([memberId, stats]: [string, any]) => {
      const percentileIndex = sortedLuck.indexOf(stats.luckScore);
      const luckPercentile = sortedLuck.length > 1
        ? (percentileIndex / (sortedLuck.length - 1)) * 100
        : 50;

      return {
        leagueMembershipId: memberId,
        memberName: nameMap.get(memberId) ?? '',
        ...stats,
        luckPercentile: Math.round(luckPercentile * 10) / 10,
      };
    }).sort((a, b) => b.luckScore - a.luckScore);
  }

  /** Computes power ratings for all members in a league. */
  async computePowerRatings(leagueId: string): Promise<PowerRatingResult[]> {
    const results = await this.prisma.contestResult.findMany({
      where: { leagueId },
    });

    const memberships = await this.prisma.leagueMembership.findMany({
      where: { leagueId },
      include: { user: true },
    });
    const nameMap = new Map(memberships.map((m: any) => [m.id, m.user.displayName]));

    // Group scores by member
    const memberScores = new Map<string, { scores: number[]; wins: number; totalContests: number }>();
    for (const r of results) {
      if (!r.leagueMembershipId) continue;
      const existing = memberScores.get(r.leagueMembershipId) ?? { scores: [], wins: 0, totalContests: 0 };
      existing.scores.push(r.totalScore);
      existing.totalContests++;
      if (r.isWinner) existing.wins++;
      memberScores.set(r.leagueMembershipId, existing);
    }

    const rawRatings = computePowerRatings(memberScores);

    // Compute league average for adjustment
    const allRaw = Array.from(rawRatings.values()).map((r: any) => r.rawPowerRating);
    const leagueAvgRaw = allRaw.length > 0 ? allRaw.reduce((a, b) => a + b, 0) / allRaw.length : 1;

    return Array.from(rawRatings.entries()).map(([memberId, data]: [string, any]) => ({
      leagueMembershipId: memberId,
      memberName: nameMap.get(memberId) ?? '',
      ...data,
      adjustedPowerRating: Math.round((data.rawPowerRating / leagueAvgRaw) * 1000) / 1000,
    })).sort((a, b) => b.adjustedPowerRating - a.adjustedPowerRating);
  }

  /** Computes consistency scores for all members. */
  async computeConsistencyScores(leagueId: string): Promise<ConsistencyResult[]> {
    const results = await this.prisma.contestResult.findMany({
      where: { leagueId },
    });

    const memberships = await this.prisma.leagueMembership.findMany({
      where: { leagueId },
      include: { user: true },
    });

    const byMember = new Map<string, number[]>();
    for (const r of results) {
      if (!r.leagueMembershipId || r.percentileRank === null) continue;
      const existing = byMember.get(r.leagueMembershipId) ?? [];
      existing.push(r.percentileRank);
      byMember.set(r.leagueMembershipId, existing);
    }

    return Array.from(byMember.entries()).map(([memberId, percentiles]) => ({
      leagueMembershipId: memberId,
      ...computeConsistency(percentiles),
    })).sort((a, b) => b.consistencyScore - a.consistencyScore);
  }

  /** Awards analytics-based trophies for a league/season. */
  async awardAnalyticsTrophies(leagueId: string, seasonId?: string): Promise<number> {
    const now = new Date();
    let awarded = 0;

    // Power Player — top power rating
    const powerRatings = await this.computePowerRatings(leagueId);
    if (powerRatings.length > 0) {
      const top = powerRatings[0];
      await this.prisma.trophy.create({
        data: {
          leagueId,
          leagueMembershipId: top.leagueMembershipId,
          trophyType: 'POWER_PLAYER',
          seasonId,
          label: 'Power Player',
          description: `Highest power rating: ${top.adjustedPowerRating.toFixed(3)}`,
          awardedAt: now,
        },
      });
      awarded++;
    }

    // Unluckiest Player
    const luckScores = await this.computeLuckScores(leagueId);
    if (luckScores.length > 0) {
      const unluckiest = luckScores[luckScores.length - 1];
      if (unluckiest.luckScore < 0) {
        await this.prisma.trophy.create({
          data: {
            leagueId,
            leagueMembershipId: unluckiest.leagueMembershipId,
            trophyType: 'UNLUCKIEST_PLAYER',
            seasonId,
            label: 'Unluckiest Player',
            description: `Luck score: ${unluckiest.luckScore.toFixed(2)}`,
            awardedAt: now,
          },
        });
        awarded++;
      }
    }

    // Iron Consistent
    const consistency = await this.computeConsistencyScores(leagueId);
    if (consistency.length > 0) {
      const mostConsistent = consistency[0];
      if (mostConsistent.consistencyScore >= 70) {
        await this.prisma.trophy.create({
          data: {
            leagueId,
            leagueMembershipId: mostConsistent.leagueMembershipId,
            trophyType: 'IRON_CONSISTENT',
            seasonId,
            label: 'Iron Consistent',
            description: `Consistency score: ${mostConsistent.consistencyScore.toFixed(1)}`,
            awardedAt: now,
          },
        });
        awarded++;
      }
    }

    return awarded;
  }
}
