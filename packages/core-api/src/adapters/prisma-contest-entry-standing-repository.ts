/**
 * Prisma adapter for ContestEntryStandingRepository: the frozen entry standing (#246), core row
 * plus its scoring family's extension (golf's, or a race's), written and read together.
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
      include: {
        golf: { select: { totalScoreToPar: true } },
        race: { select: { totalPoints: true } },
      },
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
      golf: row.golf ? { totalScoreToPar: row.golf.totalScoreToPar } : null,
      race: row.race ? { totalPoints: row.race.totalPoints } : null,
    }));
  }

  async upsert(write: ContestEntryStandingWrite): Promise<void> {
    const { golf, race, contestEntryId, ...core } = write;
    await this.prisma.contestEntryStanding.upsert({
      where: { contestEntryId },
      create: {
        contestEntryId,
        ...core,
        ...(golf && { golf: { create: golf } }),
        ...(race && { race: { create: race } }),
      },
      update: {
        ...core,
        ...(golf && { golf: { upsert: { create: golf, update: golf } } }),
        ...(race && { race: { upsert: { create: race, update: race } } }),
      },
    });
  }
}
