/**
 * HistoryMergeService — merges contest history when two member accounts
 * are combined.
 *
 * Transfers all history records (ContestResult, TeamRosterHistory,
 * PayoutHistory, trophies) from the duplicate to the primary member,
 * resolving conflicts where both participated in the same contest.
 */

import type { PrismaClient } from '@prisma/client';

export interface MergePreview {
  contestResults: number;
  rosterHistories: number;
  payoutRecords: number;
  trophies: number;
  conflicts: MergeConflict[];
}

export interface MergeConflict {
  contestId: string;
  contestName: string;
  primaryRank: number;
  duplicateRank: number;
  resolution: 'KEEP_PRIMARY' | 'KEEP_BEST';
}

export interface MergeResult {
  contestResultsTransferred: number;
  payoutRecordsTransferred: number;
  trophiesTransferred: number;
  conflictsResolved: number;
  duplicateRecordsRemoved: number;
}

export class HistoryMergeService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Preview what will happen when merging duplicate into primary. */
  async previewMerge(
    primaryMemberId: string,
    duplicateMemberId: string,
  ): Promise<MergePreview> {
    const [primaryResults, duplicateResults] = await Promise.all([
      this.prisma.contestResult.findMany({
        where: { leagueMembershipId: primaryMemberId },
      }),
      this.prisma.contestResult.findMany({
        where: { leagueMembershipId: duplicateMemberId },
      }),
    ]);

    const duplicatePayouts = await this.prisma.payoutHistory.findMany({
      where: { leagueMembershipId: duplicateMemberId },
    });

    const duplicateTrophies = await this.prisma.trophy.findMany({
      where: { leagueMembershipId: duplicateMemberId },
    });

    // Find contests where both members participated
    const primaryContestIds = new Set(primaryResults.map((r) => r.contestId));
    const conflicts: MergeConflict[] = [];

    for (const dupResult of duplicateResults) {
      if (primaryContestIds.has(dupResult.contestId)) {
        const primaryResult = primaryResults.find((r) => r.contestId === dupResult.contestId)!;
        conflicts.push({
          contestId: dupResult.contestId,
          contestName: dupResult.contestName ?? '',
          primaryRank: primaryResult.finalRank,
          duplicateRank: dupResult.finalRank,
          resolution: primaryResult.finalRank <= dupResult.finalRank ? 'KEEP_PRIMARY' : 'KEEP_BEST',
        });
      }
    }

    // Count non-conflicting records to transfer
    const nonConflictResults = duplicateResults.filter(
      (r) => !primaryContestIds.has(r.contestId),
    );

    // Count roster histories for duplicate entries
    const duplicateEntryIds = duplicateResults.map((r) => r.entryId);
    const rosterHistories = await this.prisma.teamRosterHistory.count({
      where: { entryId: { in: duplicateEntryIds } },
    });

    return {
      contestResults: nonConflictResults.length,
      rosterHistories,
      payoutRecords: duplicatePayouts.length,
      trophies: duplicateTrophies.length,
      conflicts,
    };
  }

  /** Execute merge — transfer all history from duplicate to primary. */
  async executeMerge(
    primaryMemberId: string,
    duplicateMemberId: string,
  ): Promise<MergeResult> {
    const preview = await this.previewMerge(primaryMemberId, duplicateMemberId);

    let contestResultsTransferred = 0;
    let payoutRecordsTransferred = 0;
    let trophiesTransferred = 0;
    let conflictsResolved = 0;
    let duplicateRecordsRemoved = 0;

    // Get all duplicate results
    const duplicateResults = await this.prisma.contestResult.findMany({
      where: { leagueMembershipId: duplicateMemberId },
    });

    const conflictContestIds = new Set(preview.conflicts.map((c) => c.contestId));

    // Transfer non-conflicting contest results
    for (const result of duplicateResults) {
      if (conflictContestIds.has(result.contestId)) {
        // Resolve conflict
        const conflict = preview.conflicts.find((c) => c.contestId === result.contestId)!;
        if (conflict.resolution === 'KEEP_BEST' && result.finalRank < conflict.primaryRank) {
          // Duplicate has better rank — replace primary's result
          await this.prisma.contestResult.updateMany({
            where: {
              contestId: result.contestId,
              leagueMembershipId: primaryMemberId,
            },
            data: {
              finalRank: result.finalRank,
              totalScore: result.totalScore,
              prizeAmount: result.prizeAmount,
              isWinner: result.isWinner,
              isPaidPosition: result.isPaidPosition,
              percentileRank: result.percentileRank,
            },
          });
        }
        // Delete the duplicate's result either way
        await this.prisma.contestResult.delete({ where: { id: result.id } });
        conflictsResolved++;
        duplicateRecordsRemoved++;
      } else {
        // Transfer to primary
        await this.prisma.contestResult.update({
          where: { id: result.id },
          data: { leagueMembershipId: primaryMemberId },
        });
        contestResultsTransferred++;
      }
    }

    // Transfer payout records
    const updatedPayouts = await this.prisma.payoutHistory.updateMany({
      where: { leagueMembershipId: duplicateMemberId },
      data: { leagueMembershipId: primaryMemberId },
    });
    payoutRecordsTransferred = updatedPayouts.count;

    // Transfer trophies
    const updatedTrophies = await this.prisma.trophy.updateMany({
      where: { leagueMembershipId: duplicateMemberId },
      data: { leagueMembershipId: primaryMemberId },
    });
    trophiesTransferred = updatedTrophies.count;

    // Transfer rivalry records — update both member A and member B references
    await this.prisma.rivalryRecord.updateMany({
      where: { memberAId: duplicateMemberId },
      data: { memberAId: primaryMemberId },
    });
    await this.prisma.rivalryRecord.updateMany({
      where: { memberBId: duplicateMemberId },
      data: { memberBId: primaryMemberId },
    });

    return {
      contestResultsTransferred,
      payoutRecordsTransferred,
      trophiesTransferred,
      conflictsResolved,
      duplicateRecordsRemoved,
    };
  }
}
