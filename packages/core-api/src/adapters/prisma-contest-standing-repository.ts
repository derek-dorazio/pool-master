/**
 * Prisma adapter for ContestStandingRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { ContestStandingRepository } from '@poolmaster/shared/db';
import type { ContestStanding } from '@poolmaster/shared/domain';

export class PrismaContestStandingRepository implements ContestStandingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByContest(contestId: string): Promise<ContestStanding[]> {
    const rows = await this.prisma.contestStanding.findMany({
      where: { contestId },
      orderBy: { rank: 'asc' },
    });
    return rows.map(mapToStanding);
  }

  async upsert(
    standing: Omit<ContestStanding, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestStanding> {
    const row = await this.prisma.contestStanding.upsert({
      where: {
        contestId_entryId: {
          contestId: standing.contestId,
          entryId: standing.entryId,
        },
      },
      update: {
        rank: standing.rank,
        totalScore: standing.totalScore,
        lastUpdatedAt: standing.lastUpdatedAt,
      },
      create: {
        contestId: standing.contestId,
        entryId: standing.entryId,
        rank: standing.rank,
        totalScore: standing.totalScore,
        lastUpdatedAt: standing.lastUpdatedAt,
      },
    });
    return mapToStanding(row);
  }
}

function mapToStanding(row: {
  id: string;
  contestId: string;
  entryId: string;
  rank: number;
  totalScore: number;
  lastUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): ContestStanding {
  return {
    id: row.id,
    contestId: row.contestId,
    entryId: row.entryId,
    rank: row.rank,
    totalScore: row.totalScore,
    lastUpdatedAt: row.lastUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
