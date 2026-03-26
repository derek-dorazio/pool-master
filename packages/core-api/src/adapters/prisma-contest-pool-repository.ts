/**
 * Prisma adapter for ContestPoolRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { ContestPoolRepository } from '@poolmaster/shared/db';
import type { ContestPool, ContestPoolConfig, PoolType } from '@poolmaster/shared/domain';

export class PrismaContestPoolRepository implements ContestPoolRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByContest(contestId: string): Promise<ContestPool | null> {
    const row = await this.prisma.contestPool.findUnique({
      where: { contestId },
    });
    return row ? mapToContestPool(row) : null;
  }

  async create(pool: Omit<ContestPool, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContestPool> {
    const row = await this.prisma.contestPool.create({
      data: {
        contestId: pool.contestId,
        sport: pool.sport,
        eventId: pool.eventId,
        poolType: pool.poolType,
        config: pool.config as object,
        excludedParticipantIds: pool.excludedParticipantIds,
        poolLocked: pool.poolLocked,
        poolLockedAt: pool.poolLockedAt,
      },
    });
    return mapToContestPool(row);
  }

  async update(id: string, updates: Partial<ContestPool>): Promise<ContestPool> {
    const row = await this.prisma.contestPool.update({
      where: { id },
      data: {
        ...(updates.poolType !== undefined && { poolType: updates.poolType }),
        ...(updates.config !== undefined && { config: updates.config as object }),
        ...(updates.excludedParticipantIds !== undefined && {
          excludedParticipantIds: updates.excludedParticipantIds,
        }),
        ...(updates.eventId !== undefined && { eventId: updates.eventId }),
        ...(updates.poolLocked !== undefined && { poolLocked: updates.poolLocked }),
        ...(updates.poolLockedAt !== undefined && { poolLockedAt: updates.poolLockedAt }),
      },
    });
    return mapToContestPool(row);
  }

  async lock(id: string): Promise<ContestPool> {
    const row = await this.prisma.contestPool.update({
      where: { id },
      data: {
        poolLocked: true,
        poolLockedAt: new Date(),
      },
    });
    return mapToContestPool(row);
  }
}

function mapToContestPool(row: {
  id: string;
  contestId: string;
  sport: string;
  eventId: string | null;
  poolType: string;
  config: unknown;
  excludedParticipantIds: string[];
  poolLocked: boolean;
  poolLockedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ContestPool {
  return {
    id: row.id,
    contestId: row.contestId,
    sport: row.sport as ContestPool['sport'],
    eventId: row.eventId ?? undefined,
    poolType: row.poolType as PoolType,
    config: (row.config ?? {}) as ContestPoolConfig,
    excludedParticipantIds: row.excludedParticipantIds,
    poolLocked: row.poolLocked,
    poolLockedAt: row.poolLockedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
