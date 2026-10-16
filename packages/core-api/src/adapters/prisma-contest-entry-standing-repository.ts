/**
 * Prisma adapter for ContestEntryStandingRepository: the frozen entry standing (#246), with the
 * settled total every scoring family stores on the one row (#695).
 */

import type { PrismaClient } from '@prisma/client';
import type {
  ContestEntryStandingRepository,
  ContestEntryStandingResult,
  ContestEntryStandingWrite,
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

  async upsert(write: ContestEntryStandingWrite): Promise<void> {
    const { contestEntryId, ...standing } = write;
    await this.prisma.contestEntryStanding.upsert({
      where: { contestEntryId },
      create: { contestEntryId, ...standing },
      update: standing,
    });
  }
}
