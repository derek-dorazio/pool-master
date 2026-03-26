/**
 * HistoryService — reads contest history, standings, and summaries.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  ContestHistorySummary,
  ContestHighlights,
  ContestResult,
  PayoutHistoryRecord,
} from '@poolmaster/shared/domain';

export class HistoryService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Returns a full contest history summary for a completed contest. */
  async getContestSummary(contestId: string): Promise<ContestHistorySummary | null> {
    const results = await this.prisma.contestResult.findMany({
      where: { contestId },
      orderBy: { finalRank: 'asc' },
    });

    if (results.length === 0) return null;

    const first = results[0];

    const payouts = await this.prisma.payoutHistory.findMany({
      where: { contestId },
      orderBy: { prizeRank: 'asc' },
    });

    const entries = await this.prisma.contestEntry.findMany({
      where: { contestId },
    });
    const entryNameMap = new Map(entries.map((e) => [e.id, e.name]));

    const highlights = buildHighlights(results, entryNameMap);

    return {
      contestId,
      contestName: first.contestName ?? '',
      sport: first.sport ?? '',
      contestType: first.contestType ?? '',
      startedAt: first.startedAt ?? undefined,
      endedAt: first.endedAt ?? undefined,
      numEntries: first.numEntries ?? results.length,
      finalStandings: results.map(mapResult),
      payouts: payouts.map(mapPayout),
      highlights,
    };
  }

  /** Returns final standings for a contest. */
  async getContestStandings(contestId: string): Promise<ContestResult[]> {
    const results = await this.prisma.contestResult.findMany({
      where: { contestId },
      orderBy: { finalRank: 'asc' },
    });
    return results.map(mapResult);
  }

  /** Returns all contest results for a league member across all contests. */
  async getMemberResults(leagueMembershipId: string): Promise<ContestResult[]> {
    const results = await this.prisma.contestResult.findMany({
      where: { leagueMembershipId },
      orderBy: { closedAt: 'desc' },
    });
    return results.map(mapResult);
  }

  /** Returns all contest results for a league. */
  async getLeagueResults(leagueId: string): Promise<ContestResult[]> {
    const results = await this.prisma.contestResult.findMany({
      where: { leagueId },
      orderBy: { closedAt: 'desc' },
    });
    return results.map(mapResult);
  }

  /** Returns roster history snapshot for an entry. */
  async getRosterHistory(contestId: string, entryId: string) {
    return this.prisma.teamRosterHistory.findUnique({
      where: { contestId_entryId: { contestId, entryId } },
    });
  }

  /** Returns payout history for a contest. */
  async getContestPayouts(contestId: string): Promise<PayoutHistoryRecord[]> {
    const payouts = await this.prisma.payoutHistory.findMany({
      where: { contestId },
      orderBy: { prizeRank: 'asc' },
    });
    return payouts.map(mapPayout);
  }
}

function buildHighlights(
  results: Array<{ entryId: string; totalScore: number; finalRank: number }>,
  entryNames: Map<string, string>,
): ContestHighlights {
  if (results.length === 0) return {};

  const sorted = [...results].sort((a, b) => b.totalScore - a.totalScore);
  const highest = sorted[0];
  const lowest = sorted[sorted.length - 1];

  // Closest finish: smallest gap between consecutive ranks
  let closestMargin = Infinity;
  let winnerMargin: number | undefined;

  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = Math.abs(sorted[i].totalScore - sorted[i + 1].totalScore);
    if (gap < closestMargin) closestMargin = gap;
  }

  if (sorted.length >= 2) {
    winnerMargin = Math.abs(sorted[0].totalScore - sorted[1].totalScore);
  }

  return {
    highestScore: {
      entryId: highest.entryId,
      entryName: entryNames.get(highest.entryId) ?? '',
      score: highest.totalScore,
    },
    lowestScore: {
      entryId: lowest.entryId,
      entryName: entryNames.get(lowest.entryId) ?? '',
      score: lowest.totalScore,
    },
    closestFinish: closestMargin < Infinity ? { margin: closestMargin } : undefined,
    winnerMargin,
  };
}

function mapResult(row: {
  id: string;
  contestId: string;
  entryId: string;
  finalRank: number;
  totalScore: number;
  prizeAmount: number | null;
  leagueId: string | null;
  seasonId: string | null;
  leagueMembershipId: string | null;
  contestName: string | null;
  contestType: string | null;
  sport: string | null;
  numEntries: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  isWinner: boolean;
  isPaidPosition: boolean;
  entryFeePaid: number | null;
  prizeLabel: string | null;
  netResult: number | null;
  percentileRank: number | null;
  pointsBehindWinner: number | null;
  pointsBehindNext: number | null;
  draftPosition: number | null;
  rosterSnapshotId: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ContestResult {
  return {
    id: row.id,
    contestId: row.contestId,
    entryId: row.entryId,
    finalRank: row.finalRank,
    totalScore: row.totalScore,
    prizeAmount: row.prizeAmount ?? undefined,
    leagueId: row.leagueId ?? undefined,
    seasonId: row.seasonId ?? undefined,
    leagueMembershipId: row.leagueMembershipId ?? undefined,
    contestName: row.contestName ?? undefined,
    contestType: row.contestType ?? undefined,
    sport: row.sport ?? undefined,
    numEntries: row.numEntries ?? undefined,
    startedAt: row.startedAt ?? undefined,
    endedAt: row.endedAt ?? undefined,
    isWinner: row.isWinner,
    isPaidPosition: row.isPaidPosition,
    entryFeePaid: row.entryFeePaid ?? undefined,
    prizeLabel: row.prizeLabel ?? undefined,
    netResult: row.netResult ?? undefined,
    percentileRank: row.percentileRank ?? undefined,
    pointsBehindWinner: row.pointsBehindWinner ?? undefined,
    pointsBehindNext: row.pointsBehindNext ?? undefined,
    draftPosition: row.draftPosition ?? undefined,
    rosterSnapshotId: row.rosterSnapshotId ?? undefined,
    closedAt: row.closedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPayout(row: {
  id: string;
  contestId: string;
  leagueId: string;
  entryId: string;
  leagueMembershipId: string;
  prizeType: string;
  prizeLabel: string;
  prizeRank: number | null;
  amount: number;
  isCash: boolean;
  nonCashDescription: string | null;
  paidAt: Date | null;
  acknowledgedByMember: boolean;
  createdAt: Date;
}): PayoutHistoryRecord {
  return {
    id: row.id,
    contestId: row.contestId,
    leagueId: row.leagueId,
    entryId: row.entryId,
    leagueMembershipId: row.leagueMembershipId,
    prizeType: row.prizeType as PayoutHistoryRecord['prizeType'],
    prizeLabel: row.prizeLabel,
    prizeRank: row.prizeRank ?? undefined,
    amount: row.amount,
    isCash: row.isCash,
    nonCashDescription: row.nonCashDescription ?? undefined,
    paidAt: row.paidAt ?? undefined,
    acknowledgedByMember: row.acknowledgedByMember,
    createdAt: row.createdAt,
  };
}
