/**
 * Prisma adapter for ContestEntryStandingRepository: the frozen entry standing (#246), with the
 * settled total every scoring family stores on the one row (#695).
 */

import type { PrismaClient } from '@prisma/client';
import type {
  ContestEntryEventStandingRepository,
  ContestEntryEventStandingResult,
  ContestEntryEventStandingWrite,
  ContestEntryStandingRepository,
  ContestEntryStandingResult,
  ContestEntryStandingWrite,
  ContestWinner,
} from '@poolmaster/shared/db';

export class PrismaContestEntryStandingRepository implements ContestEntryStandingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByContest(contestId: string): Promise<ContestEntryStandingResult[]> {
    const rows = await this.prisma.contestEntryStanding.findMany({
      where: { contestId },
      orderBy: [{ position: { sort: 'asc', nulls: 'last' } }, { contestEntryId: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      contestId: row.contestId,
      contestEntryId: row.contestEntryId,
      position: row.position,
      displayPosition: row.displayPosition,
      countingPickLimit: row.countingPickLimit,
      scoredPickCount: row.scoredPickCount,
      asOf: row.asOf,
      settledAt: row.settledAt,
      totalScore: row.totalScore,
    }));
  }

  async findWinnersByContests(contestIds: readonly string[]): Promise<ContestWinner[]> {
    if (contestIds.length === 0) return [];
    const rows = await this.prisma.contestEntryStanding.findMany({
      where: { contestId: { in: [...new Set(contestIds)] }, position: 1 },
      select: { contestId: true, contestEntry: { select: { name: true } } },
      orderBy: [{ contestId: 'asc' }, { contestEntry: { entryNumber: 'asc' } }, { contestEntry: { name: 'asc' } }],
    });
    return rows.map((row) => ({ contestId: row.contestId, entryName: row.contestEntry.name }));
  }

  async upsert(write: ContestEntryStandingWrite): Promise<void> {
    const { contestEntryId, ...standing } = write;
    await this.prisma.contestEntryStanding.upsert({
      where: { contestEntryId },
      create: { contestEntryId, ...standing },
      update: standing,
    });
  }
}

/** Prisma adapter for the per-event entry standing (#713), the same columns narrowed to an event. */
export class PrismaContestEntryEventStandingRepository implements ContestEntryEventStandingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByContest(contestId: string): Promise<ContestEntryEventStandingResult[]> {
    return this.findByContests([contestId]);
  }

  async findByContests(contestIds: readonly string[]): Promise<ContestEntryEventStandingResult[]> {
    if (contestIds.length === 0) return [];
    const rows = await this.prisma.contestEntryEventStanding.findMany({
      where: { contestId: { in: [...contestIds] } },
      orderBy: [{ contestId: 'asc' }, { sportEventId: 'asc' }, { position: { sort: 'asc', nulls: 'last' } }, { contestEntryId: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      contestId: row.contestId,
      contestEntryId: row.contestEntryId,
      sportEventId: row.sportEventId,
      position: row.position,
      displayPosition: row.displayPosition,
      countingPickLimit: row.countingPickLimit,
      scoredPickCount: row.scoredPickCount,
      asOf: row.asOf,
      settledAt: row.settledAt,
      totalScore: row.totalScore,
    }));
  }

  async upsert(write: ContestEntryEventStandingWrite): Promise<void> {
    const { contestEntryId, sportEventId, ...standing } = write;
    await this.prisma.contestEntryEventStanding.upsert({
      where: { contestEntryId_sportEventId: { contestEntryId, sportEventId } },
      create: { contestEntryId, sportEventId, ...standing },
      update: standing,
    });
  }
}
