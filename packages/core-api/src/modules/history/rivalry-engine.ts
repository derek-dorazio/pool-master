/**
 * RivalryEngine — computes head-to-head records between all member pairs in a league.
 *
 * Rivalry is based on shared contest participation: when two members both enter
 * the same contest, whoever finishes higher "wins" that rivalry matchup.
 */

import { type PrismaClient, Prisma } from '@prisma/client';

export interface RivalrySummary {
  memberAId: string;
  memberBId: string;
  memberAName: string;
  memberBName: string;
  totalContestsShared: number;
  memberAHigherFinishes: number;
  memberBHigherFinishes: number;
  ties: number;
  memberAWinPct: number;
  currentStreak?: { leaderId: string; length: number };
}

export class RivalryEngine {
  constructor(private readonly prisma: PrismaClient) {}

  /** Recomputes all rivalry records for a league. */
  async recomputeRivalries(leagueId: string): Promise<number> {
    const results = await this.prisma.contestResult.findMany({
      where: { leagueId },
      orderBy: { closedAt: 'asc' },
    });

    if (results.length === 0) return 0;

    // Get member names
    const memberships = await this.prisma.leagueMembership.findMany({
      where: { leagueId },
      include: { user: true },
    });
    const memberIds = memberships.map((m) => m.id);

    // Group results by contest
    const byContest = new Map<string, typeof results>();
    for (const r of results) {
      if (!r.leagueMembershipId) continue;
      const existing = byContest.get(r.contestId) ?? [];
      existing.push(r);
      byContest.set(r.contestId, existing);
    }

    // For each pair of members, compute rivalry
    const pairMap = new Map<string, {
      memberAId: string;
      memberBId: string;
      aHigher: number;
      bHigher: number;
      ties: number;
      totalShared: number;
      aTotalPoints: number;
      bTotalPoints: number;
      history: Array<{ winnerId: string | null; margin: number; contestId: string; date: Date }>;
    }>();

    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        const a = memberIds[i];
        const b = memberIds[j];
        const key = `${a}:${b}`;

        const rivalry = {
          memberAId: a,
          memberBId: b,
          aHigher: 0,
          bHigher: 0,
          ties: 0,
          totalShared: 0,
          aTotalPoints: 0,
          bTotalPoints: 0,
          history: [] as Array<{ winnerId: string | null; margin: number; contestId: string; date: Date }>,
        };

        for (const [contestId, contestResults] of byContest) {
          const aResult = contestResults.find((r) => r.leagueMembershipId === a);
          const bResult = contestResults.find((r) => r.leagueMembershipId === b);

          if (!aResult || !bResult) continue;

          rivalry.totalShared++;
          rivalry.aTotalPoints += aResult.totalScore;
          rivalry.bTotalPoints += bResult.totalScore;

          const margin = Math.abs(aResult.totalScore - bResult.totalScore);

          if (aResult.finalRank < bResult.finalRank) {
            rivalry.aHigher++;
            rivalry.history.push({ winnerId: a, margin, contestId, date: aResult.closedAt ?? new Date() });
          } else if (bResult.finalRank < aResult.finalRank) {
            rivalry.bHigher++;
            rivalry.history.push({ winnerId: b, margin, contestId, date: bResult.closedAt ?? new Date() });
          } else {
            rivalry.ties++;
            rivalry.history.push({ winnerId: null, margin: 0, contestId, date: aResult.closedAt ?? new Date() });
          }
        }

        if (rivalry.totalShared > 0) {
          pairMap.set(key, rivalry);
        }
      }
    }

    // Compute streaks and notable matchups, then upsert
    const now = new Date();
    let written = 0;

    for (const rivalry of pairMap.values()) {
      // Current streak
      let currentStreak: { leaderId: string; length: number } | undefined;
      let streakLeader = '';
      let streakLen = 0;
      for (let k = rivalry.history.length - 1; k >= 0; k--) {
        const h = rivalry.history[k];
        if (!h.winnerId) break;
        if (streakLeader === '') {
          streakLeader = h.winnerId;
          streakLen = 1;
        } else if (h.winnerId === streakLeader) {
          streakLen++;
        } else {
          break;
        }
      }
      if (streakLen > 0) {
        currentStreak = { leaderId: streakLeader, length: streakLen };
      }

      // Longest streak
      let longestStreak: { holderId: string; length: number } | undefined;
      let bestLen = 0;
      let bestHolder = '';
      let runLen = 0;
      let runHolder = '';
      for (const h of rivalry.history) {
        if (h.winnerId === runHolder && h.winnerId) {
          runLen++;
        } else if (h.winnerId) {
          runLen = 1;
          runHolder = h.winnerId;
        } else {
          runLen = 0;
          runHolder = '';
        }
        if (runLen > bestLen) {
          bestLen = runLen;
          bestHolder = runHolder;
        }
      }
      if (bestLen > 0) {
        longestStreak = { holderId: bestHolder, length: bestLen };
      }

      // Biggest margin and closest finish
      const withMargins = rivalry.history.filter((h) => h.winnerId);
      const biggestMargin = withMargins.length > 0
        ? withMargins.reduce((best, h) => h.margin > best.margin ? h : best)
        : undefined;
      const closestFinish = withMargins.length > 0
        ? withMargins.reduce((best, h) => h.margin < best.margin ? h : best)
        : undefined;

      await this.prisma.rivalryRecord.upsert({
        where: {
          leagueId_memberAId_memberBId: {
            leagueId,
            memberAId: rivalry.memberAId,
            memberBId: rivalry.memberBId,
          },
        },
        create: {
          leagueId,
          memberAId: rivalry.memberAId,
          memberBId: rivalry.memberBId,
          totalContestsShared: rivalry.totalShared,
          memberAHigherFinishes: rivalry.aHigher,
          memberBHigherFinishes: rivalry.bHigher,
          ties: rivalry.ties,
          memberATotalPoints: rivalry.aTotalPoints,
          memberBTotalPoints: rivalry.bTotalPoints,
          currentStreak: currentStreak ? (currentStreak as unknown as object) : Prisma.JsonNull,
          longestStreak: longestStreak ? (longestStreak as unknown as object) : Prisma.JsonNull,
          biggestMargin: biggestMargin ? (biggestMargin as unknown as object) : Prisma.JsonNull,
          closestFinish: closestFinish ? (closestFinish as unknown as object) : Prisma.JsonNull,
          lastContestAt: rivalry.history[rivalry.history.length - 1]?.date,
          lastUpdatedAt: now,
        },
        update: {
          totalContestsShared: rivalry.totalShared,
          memberAHigherFinishes: rivalry.aHigher,
          memberBHigherFinishes: rivalry.bHigher,
          ties: rivalry.ties,
          memberATotalPoints: rivalry.aTotalPoints,
          memberBTotalPoints: rivalry.bTotalPoints,
          currentStreak: currentStreak ? (currentStreak as unknown as object) : Prisma.JsonNull,
          longestStreak: longestStreak ? (longestStreak as unknown as object) : Prisma.JsonNull,
          biggestMargin: biggestMargin ? (biggestMargin as unknown as object) : Prisma.JsonNull,
          closestFinish: closestFinish ? (closestFinish as unknown as object) : Prisma.JsonNull,
          lastContestAt: rivalry.history[rivalry.history.length - 1]?.date,
          lastUpdatedAt: now,
        },
      });
      written++;
    }

    return written;
  }

  /** Returns all rivalries for a league. */
  async getRivalries(leagueId: string) {
    return this.prisma.rivalryRecord.findMany({
      where: { leagueId },
      orderBy: { totalContestsShared: 'desc' },
    });
  }

  /** Returns the rivalry between two specific members. */
  async getRivalry(leagueId: string, memberAId: string, memberBId: string) {
    // Ensure consistent ordering
    const [a, b] = memberAId < memberBId ? [memberAId, memberBId] : [memberBId, memberAId];
    return this.prisma.rivalryRecord.findUnique({
      where: { leagueId_memberAId_memberBId: { leagueId, memberAId: a, memberBId: b } },
    });
  }
}
