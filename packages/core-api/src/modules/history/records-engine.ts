/**
 * RecordsEngine — scans ContestResult to maintain the league record book.
 *
 * Records are categorised by scope: ALL_TIME, SINGLE_SEASON, SINGLE_CONTEST.
 * Each record tracks who holds it, when it was set, and the previous record.
 */

import type { PrismaClient } from '@prisma/client';

export type RecordCategory =
  | 'HIGHEST_SINGLE_CONTEST_SCORE'
  | 'LOWEST_SINGLE_CONTEST_SCORE'
  | 'MOST_CHAMPIONSHIPS_ALL_TIME'
  | 'MOST_CONSECUTIVE_CHAMPIONSHIPS'
  | 'MOST_RUNNER_UP_FINISHES'
  | 'MOST_TOP_3_FINISHES'
  | 'MOST_CONTESTS_ENTERED'
  | 'MOST_TOTAL_WINNINGS'
  | 'BEST_NET_ROI'
  | 'WORST_NET_ROI'
  | 'LONGEST_WIN_STREAK'
  | 'LONGEST_LOSS_STREAK'
  | 'MOST_CONSISTENT_ALL_TIME'
  | 'BEST_SINGLE_SEASON_WIN_RATE'
  | 'BIGGEST_WIN_MARGIN';

type RecordScope = 'ALL_TIME' | 'SINGLE_SEASON' | 'SINGLE_CONTEST';

interface RecordCandidate {
  category: RecordCategory;
  scope: RecordScope;
  value: number;
  label: string;
  memberId: string;
  memberName: string;
  contestId?: string;
  seasonId?: string;
  setAt: Date;
}

export class RecordsEngine {
  constructor(private readonly prisma: PrismaClient) {}

  /** Recomputes all records for a league. Call after contest close. */
  async recomputeAllRecords(leagueId: string): Promise<number> {
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
    const memberNameMap = new Map(memberships.map((m) => [m.id, m.user.displayName]));

    const candidates: RecordCandidate[] = [];
    const now = new Date();

    // --- Single Contest Records ---

    // Highest and lowest single contest scores
    const sortedByScore = [...results].sort((a, b) => b.totalScore - a.totalScore);
    if (sortedByScore.length > 0) {
      const highest = sortedByScore[0];
      candidates.push({
        category: 'HIGHEST_SINGLE_CONTEST_SCORE',
        scope: 'SINGLE_CONTEST',
        value: highest.totalScore,
        label: `${highest.totalScore} points`,
        memberId: highest.leagueMembershipId ?? '',
        memberName: memberNameMap.get(highest.leagueMembershipId ?? '') ?? '',
        contestId: highest.contestId,
        setAt: highest.closedAt ?? now,
      });

      const lowest = sortedByScore[sortedByScore.length - 1];
      candidates.push({
        category: 'LOWEST_SINGLE_CONTEST_SCORE',
        scope: 'SINGLE_CONTEST',
        value: lowest.totalScore,
        label: `${lowest.totalScore} points`,
        memberId: lowest.leagueMembershipId ?? '',
        memberName: memberNameMap.get(lowest.leagueMembershipId ?? '') ?? '',
        contestId: lowest.contestId,
        setAt: lowest.closedAt ?? now,
      });
    }

    // Biggest win margin
    const contestIds = [...new Set(results.map((r) => r.contestId))];
    for (const contestId of contestIds) {
      const contestResults = results
        .filter((r) => r.contestId === contestId)
        .sort((a, b) => a.finalRank - b.finalRank);
      if (contestResults.length >= 2) {
        const margin = Math.abs(contestResults[0].totalScore - contestResults[1].totalScore);
        const winner = contestResults[0];
        candidates.push({
          category: 'BIGGEST_WIN_MARGIN',
          scope: 'SINGLE_CONTEST',
          value: margin,
          label: `Won by ${margin.toFixed(1)} points`,
          memberId: winner.leagueMembershipId ?? '',
          memberName: memberNameMap.get(winner.leagueMembershipId ?? '') ?? '',
          contestId,
          setAt: winner.closedAt ?? now,
        });
      }
    }

    // --- All-Time Member Records ---

    const byMember = new Map<string, typeof results>();
    for (const r of results) {
      if (!r.leagueMembershipId) continue;
      const existing = byMember.get(r.leagueMembershipId) ?? [];
      existing.push(r);
      byMember.set(r.leagueMembershipId, existing);
    }

    for (const [memberId, memberResults] of byMember) {
      const name = memberNameMap.get(memberId) ?? '';
      const wins = memberResults.filter((r) => r.isWinner).length;
      const runnerUps = memberResults.filter((r) => r.finalRank === 2).length;
      const top3s = memberResults.filter((r) => r.finalRank <= 3).length;
      const totalPrizes = memberResults.reduce((s, r) => s + (r.prizeAmount ?? 0), 0);
      const totalFees = memberResults.reduce((s, r) => s + (r.entryFeePaid ?? 0), 0);
      const netRoi = totalFees > 0 ? (totalPrizes - totalFees) / totalFees : 0;

      candidates.push(
        { category: 'MOST_CHAMPIONSHIPS_ALL_TIME', scope: 'ALL_TIME', value: wins, label: `${wins} championships`, memberId, memberName: name, setAt: now },
        { category: 'MOST_RUNNER_UP_FINISHES', scope: 'ALL_TIME', value: runnerUps, label: `${runnerUps} runner-up finishes`, memberId, memberName: name, setAt: now },
        { category: 'MOST_TOP_3_FINISHES', scope: 'ALL_TIME', value: top3s, label: `${top3s} top-3 finishes`, memberId, memberName: name, setAt: now },
        { category: 'MOST_CONTESTS_ENTERED', scope: 'ALL_TIME', value: memberResults.length, label: `${memberResults.length} contests`, memberId, memberName: name, setAt: now },
        { category: 'MOST_TOTAL_WINNINGS', scope: 'ALL_TIME', value: totalPrizes, label: `$${(totalPrizes / 100).toFixed(2)}`, memberId, memberName: name, setAt: now },
        { category: 'BEST_NET_ROI', scope: 'ALL_TIME', value: netRoi, label: `${(netRoi * 100).toFixed(1)}% ROI`, memberId, memberName: name, setAt: now },
      );

      // Consistency (lowest std dev of percentile ranks)
      const percentiles = memberResults.map((r) => r.percentileRank ?? 50);
      if (percentiles.length >= 3) {
        const mean = percentiles.reduce((a, b) => a + b, 0) / percentiles.length;
        const variance = percentiles.reduce((sum, p) => sum + (p - mean) ** 2, 0) / percentiles.length;
        const stdDev = Math.sqrt(variance);
        const consistency = 100 - stdDev;
        candidates.push({
          category: 'MOST_CONSISTENT_ALL_TIME', scope: 'ALL_TIME',
          value: consistency, label: `${consistency.toFixed(1)} consistency score`,
          memberId, memberName: name, setAt: now,
        });
      }

      // Win/loss streaks
      const chronological = [...memberResults].sort(
        (a, b) => (a.closedAt?.getTime() ?? 0) - (b.closedAt?.getTime() ?? 0),
      );
      let maxWinStreak = 0;
      let maxLossStreak = 0;
      let currentWin = 0;
      let currentLoss = 0;
      for (const r of chronological) {
        if (r.isWinner) {
          currentWin++;
          currentLoss = 0;
          maxWinStreak = Math.max(maxWinStreak, currentWin);
        } else {
          currentLoss++;
          currentWin = 0;
          // Count bottom half as "loss" for streak purposes
          if ((r.percentileRank ?? 50) < 25) {
            maxLossStreak = Math.max(maxLossStreak, currentLoss);
          }
        }
      }
      if (maxWinStreak > 0) {
        candidates.push({
          category: 'LONGEST_WIN_STREAK', scope: 'ALL_TIME',
          value: maxWinStreak, label: `${maxWinStreak} consecutive wins`,
          memberId, memberName: name, setAt: now,
        });
      }
    }

    // Keep only the best candidate per category+scope
    const bestByCategory = new Map<string, RecordCandidate>();
    for (const c of candidates) {
      const key = `${c.category}:${c.scope}`;
      const existing = bestByCategory.get(key);

      const isHigherBetter = c.category !== 'LOWEST_SINGLE_CONTEST_SCORE' && c.category !== 'WORST_NET_ROI';
      const isBetter = !existing ||
        (isHigherBetter ? c.value > existing.value : c.value < existing.value);

      if (isBetter) {
        bestByCategory.set(key, c);
      }
    }

    // Upsert records
    let written = 0;
    for (const candidate of bestByCategory.values()) {
      if (!candidate.memberId) continue;

      const existing = await this.prisma.leagueRecord.findUnique({
        where: { leagueId_category_scope: { leagueId, category: candidate.category, scope: candidate.scope } },
      });

      const previousRecord = existing
        ? { value: existing.recordValue, heldBy: existing.heldByMemberName, setAt: existing.setAt }
        : undefined;

      await this.prisma.leagueRecord.upsert({
        where: { leagueId_category_scope: { leagueId, category: candidate.category, scope: candidate.scope } },
        create: {
          leagueId,
          category: candidate.category,
          scope: candidate.scope,
          recordValue: candidate.value,
          recordLabel: candidate.label,
          heldByMemberId: candidate.memberId,
          heldByMemberName: candidate.memberName,
          setInContestId: candidate.contestId,
          setInSeasonId: candidate.seasonId,
          setAt: candidate.setAt,
          lastComputedAt: now,
        },
        update: {
          recordValue: candidate.value,
          recordLabel: candidate.label,
          heldByMemberId: candidate.memberId,
          heldByMemberName: candidate.memberName,
          setInContestId: candidate.contestId,
          setInSeasonId: candidate.seasonId,
          setAt: candidate.setAt,
          previousRecord: previousRecord ? (previousRecord as unknown as object) : undefined,
          lastComputedAt: now,
        },
      });
      written++;
    }

    return written;
  }

  /** Returns all records for a league. */
  async getRecords(leagueId: string) {
    return this.prisma.leagueRecord.findMany({
      where: { leagueId },
      orderBy: { category: 'asc' },
    });
  }

  /** Returns a specific record by category. */
  async getRecord(leagueId: string, category: string) {
    return this.prisma.leagueRecord.findUnique({
      where: { leagueId_category_scope: { leagueId, category, scope: 'ALL_TIME' } },
    });
  }
}
