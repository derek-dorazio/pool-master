/**
 * Prisma adapter for squares contests' boxes, digits and frozen winners (#711).
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  ContestEntrySquareClaim,
  ContestEntrySquareClaimResult,
  ContestEntrySquareClearResult,
  ContestEntrySquareKey,
  ContestSquaresDrawWrite,
  ContestSquaresRepository,
} from '@poolmaster/shared/db';
import { ContestEntryStatus, type ContestEntrySquare, type ContestSquaresDraw, type ContestSquaresWinner } from '@poolmaster/shared/domain';
import { lockContestRow } from './contest-row-lock';

export class PrismaSquaresRepository implements ContestSquaresRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findSquares(contestId: string): Promise<ContestEntrySquare[]> {
    const rows = await this.prisma.contestEntrySquare.findMany({
      where: { contestId },
      orderBy: [{ rowIndex: 'asc' }, { columnIndex: 'asc' }],
    });
    return rows.map((row) => ({
      contestId: row.contestId,
      contestEntryId: row.contestEntryId,
      rowIndex: row.rowIndex,
      columnIndex: row.columnIndex,
      claimedByUserId: row.claimedByUserId,
      claimedAt: row.claimedAt,
    }));
  }

  async claim(claim: ContestEntrySquareClaim): Promise<ContestEntrySquareClaimResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockContestRow(tx, claim.contestId);
        if (await tx.contestSquaresDraw.count({ where: { contestId: claim.contestId } }) > 0) return 'drawn';
        const held = await tx.contestEntrySquare.count({ where: { contestEntryId: claim.contestEntryId } });
        if (held >= claim.maxSquaresPerEntry) return 'limitReached';
        await tx.contestEntrySquare.create({
          data: {
            contestId: claim.contestId,
            contestEntryId: claim.contestEntryId,
            rowIndex: claim.rowIndex,
            columnIndex: claim.columnIndex,
            claimedByUserId: claim.claimedByUserId,
          },
        });
        return 'claimed';
      });
    } catch (error) {
      // The unique key on (contest, row, column) is what settles two claims of one box.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'taken';
      throw error;
    }
  }

  async clear(box: ContestEntrySquareKey): Promise<ContestEntrySquareClearResult> {
    const { contestId, contestEntryId, rowIndex, columnIndex } = box;
    return this.prisma.$transaction(async (tx) => {
      await lockContestRow(tx, contestId);
      if (await tx.contestSquaresDraw.count({ where: { contestId } }) > 0) return 'drawn';
      const { count } = await tx.contestEntrySquare.deleteMany({ where: { contestId, contestEntryId, rowIndex, columnIndex } });
      return count > 0 ? 'cleared' : 'empty';
    });
  }

  async findDraw(contestId: string): Promise<ContestSquaresDraw | null> {
    const row = await this.prisma.contestSquaresDraw.findUnique({ where: { contestId } });
    return row && {
      contestId: row.contestId,
      seed: row.seed,
      rowDigits: row.rowDigits,
      columnDigits: row.columnDigits,
      drawnByUserId: row.drawnByUserId,
      drawnAt: row.drawnAt,
    };
  }

  async recordDraw(draw: ContestSquaresDrawWrite): Promise<'drawn' | 'alreadyDrawn'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockContestRow(tx, draw.contestId);
        await tx.contestSquaresDraw.create({
          data: {
            contestId: draw.contestId,
            seed: draw.seed,
            rowDigits: [...draw.rowDigits],
            columnDigits: [...draw.columnDigits],
            drawnByUserId: draw.drawnByUserId,
            drawnAt: draw.drawnAt,
          },
        });
        // Read under the lock, so no box is claimed or cleared between this and the draw.
        const holders = await tx.contestEntrySquare.findMany({
          where: { contestId: draw.contestId },
          select: { contestEntryId: true },
          distinct: ['contestEntryId'],
        });
        await tx.contestEntryEvent.updateMany({
          where: { contestEntryId: { in: holders.map((holder) => holder.contestEntryId) }, sportEventId: draw.sportEventId },
          data: { status: ContestEntryStatus.SUBMITTED, submittedAt: draw.drawnAt },
        });
        return 'drawn' as const;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'alreadyDrawn';
      throw error;
    }
  }

  async findWinners(contestId: string): Promise<ContestSquaresWinner[]> {
    const rows = await this.prisma.contestSquaresWinner.findMany({ where: { contestId }, orderBy: { periodNumber: 'asc' } });
    return rows.map((row) => ({
      contestId: row.contestId,
      periodNumber: row.periodNumber,
      homeScore: row.homeScore,
      awayScore: row.awayScore,
      rowIndex: row.rowIndex,
      columnIndex: row.columnIndex,
      contestEntryId: row.contestEntryId,
      settledAt: row.settledAt,
    }));
  }

  async replaceWinners(contestId: string, winners: readonly ContestSquaresWinner[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.contestSquaresWinner.deleteMany({ where: { contestId } }),
      this.prisma.contestSquaresWinner.createMany({
        data: winners.map((winner) => ({
          contestId,
          periodNumber: winner.periodNumber,
          homeScore: winner.homeScore,
          awayScore: winner.awayScore,
          rowIndex: winner.rowIndex,
          columnIndex: winner.columnIndex,
          contestEntryId: winner.contestEntryId,
          settledAt: winner.settledAt,
        })),
      }),
    ]);
  }
}
