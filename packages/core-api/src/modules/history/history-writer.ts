/**
 * HistoryWriter — writes immutable history records when a contest closes.
 *
 * Called synchronously at contest close. Writes:
 * - Enriched ContestResult rows (one per entry)
 * - TeamRosterHistory snapshots (frozen roster at lock time)
 * - PayoutHistory records
 *
 * All history records are append-only and immutable after creation.
 */

import type { PrismaClient } from '@prisma/client';

export interface ContestCloseData {
  contestId: string;
  leagueId: string;
  seasonId?: string;
  contestName: string;
  contestType: string;
  sport: string;
  startedAt?: Date;
  endedAt?: Date;
  entries: ContestCloseEntry[];
  payoutConfig?: {
    entryFee?: number;
    payoutStructure: Array<{ rank: number; amount: number; label?: string }>;
  };
}

export interface ContestCloseEntry {
  entryId: string;
  leagueMembershipId: string;
  entryName: string;
  totalScore: number;
  finalRank: number;
  draftPosition?: number;
  roster?: Array<{
    participantId: string;
    participantName: string;
    tier?: number;
    salaryCost?: number;
    draftRound?: number;
    draftPick?: number;
  }>;
  draftBudgetUsed?: number;
}

export class HistoryWriter {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Writes all history records for a closed contest.
   * Should be called in a transaction to ensure atomicity.
   */
  async writeContestHistory(data: ContestCloseData): Promise<{ resultsWritten: number; rostersWritten: number; payoutsWritten: number }> {
    const now = new Date();
    const numEntries = data.entries.length;
    const sortedEntries = [...data.entries].sort((a, b) => a.finalRank - b.finalRank);
    const winnerScore = sortedEntries[0]?.totalScore ?? 0;

    // Determine paid positions
    const paidRanks = new Set<number>();
    const payoutMap = new Map<number, { amount: number; label?: string }>();
    if (data.payoutConfig?.payoutStructure) {
      for (const slot of data.payoutConfig.payoutStructure) {
        paidRanks.add(slot.rank);
        payoutMap.set(slot.rank, { amount: slot.amount, label: slot.label });
      }
    }

    let resultsWritten = 0;
    let rostersWritten = 0;
    let payoutsWritten = 0;

    for (const entry of sortedEntries) {
      const isWinner = entry.finalRank === 1;
      const isPaid = paidRanks.has(entry.finalRank);
      const payout = payoutMap.get(entry.finalRank);
      const percentileRank = numEntries > 1
        ? ((numEntries - entry.finalRank) / (numEntries - 1)) * 100
        : 100;

      // Points behind winner
      const pointsBehindWinner = Math.abs(winnerScore - entry.totalScore);

      // Points behind next position
      const nextEntry = sortedEntries.find((e) => e.finalRank === entry.finalRank - 1);
      const pointsBehindNext = nextEntry
        ? Math.abs(nextEntry.totalScore - entry.totalScore)
        : 0;

      // Net result
      const entryFee = data.payoutConfig?.entryFee ?? 0;
      const prizeWon = payout?.amount ?? 0;
      const netResult = prizeWon - entryFee;

      // Write enriched ContestResult
      await this.prisma.contestResult.upsert({
        where: {
          contestId_entryId: {
            contestId: data.contestId,
            entryId: entry.entryId,
          },
        },
        create: {
          contestId: data.contestId,
          entryId: entry.entryId,
          finalRank: entry.finalRank,
          totalScore: entry.totalScore,
          prizeAmount: prizeWon || null,
          leagueId: data.leagueId,
          seasonId: data.seasonId,
          leagueMembershipId: entry.leagueMembershipId,
          contestName: data.contestName,
          contestType: data.contestType,
          sport: data.sport,
          numEntries: numEntries,
          startedAt: data.startedAt,
          endedAt: data.endedAt,
          isWinner,
          isPaidPosition: isPaid,
          entryFeePaid: entryFee || null,
          prizeLabel: payout?.label,
          netResult,
          percentileRank,
          pointsBehindWinner,
          pointsBehindNext,
          draftPosition: entry.draftPosition,
          closedAt: now,
        },
        update: {
          // If result already exists (e.g., re-close), update all fields
          finalRank: entry.finalRank,
          totalScore: entry.totalScore,
          prizeAmount: prizeWon || null,
          leagueId: data.leagueId,
          seasonId: data.seasonId,
          leagueMembershipId: entry.leagueMembershipId,
          contestName: data.contestName,
          contestType: data.contestType,
          sport: data.sport,
          numEntries: numEntries,
          startedAt: data.startedAt,
          endedAt: data.endedAt,
          isWinner,
          isPaidPosition: isPaid,
          entryFeePaid: entryFee || null,
          prizeLabel: payout?.label,
          netResult,
          percentileRank,
          pointsBehindWinner,
          pointsBehindNext,
          draftPosition: entry.draftPosition,
          closedAt: now,
        },
      });
      resultsWritten++;

      // Write TeamRosterHistory (frozen roster snapshot)
      if (entry.roster && entry.roster.length > 0) {
        await this.prisma.teamRosterHistory.upsert({
          where: {
            contestId_entryId: {
              contestId: data.contestId,
              entryId: entry.entryId,
            },
          },
          create: {
            contestId: data.contestId,
            entryId: entry.entryId,
            lockedAt: data.startedAt ?? now,
            roster: entry.roster,
            draftBudgetUsed: entry.draftBudgetUsed,
          },
          update: {
            roster: entry.roster,
            draftBudgetUsed: entry.draftBudgetUsed,
          },
        });
        rostersWritten++;
      }

      // Write PayoutHistory
      if (isPaid && payout) {
        await this.prisma.payoutHistory.create({
          data: {
            contestId: data.contestId,
            leagueId: data.leagueId,
            entryId: entry.entryId,
            leagueMembershipId: entry.leagueMembershipId,
            prizeType: 'FINAL_STANDING',
            prizeLabel: payout.label ?? `Place #${entry.finalRank}`,
            prizeRank: entry.finalRank,
            amount: payout.amount,
            isCash: true,
          },
        });
        payoutsWritten++;
      }
    }

    return { resultsWritten, rostersWritten, payoutsWritten };
  }
}
