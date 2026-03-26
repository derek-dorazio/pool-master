/**
 * Prisma adapter for ContestParticipantPoolRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { ContestParticipantPoolRepository } from '@poolmaster/shared/db';
import type { ContestParticipantPool } from '@poolmaster/shared/domain';
import type { TierAssignmentMethod } from '@poolmaster/shared/domain';

export class PrismaContestParticipantPoolRepository implements ContestParticipantPoolRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByContest(contestId: string): Promise<ContestParticipantPool[]> {
    const rows = await this.prisma.contestParticipantPool.findMany({
      where: { contestId },
      orderBy: { ranking: 'asc' },
    });
    return rows.map(mapToPoolParticipant);
  }

  async findByPool(poolId: string): Promise<ContestParticipantPool[]> {
    const rows = await this.prisma.contestParticipantPool.findMany({
      where: { poolId },
      orderBy: { ranking: 'asc' },
    });
    return rows.map(mapToPoolParticipant);
  }

  async create(
    entry: Omit<ContestParticipantPool, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestParticipantPool> {
    const row = await this.prisma.contestParticipantPool.create({
      data: {
        poolId: entry.poolId,
        contestId: entry.contestId,
        participantId: entry.participantId,
        cost: entry.cost,
        tier: entry.tier,
        tierAssignmentMethod: entry.tierAssignmentMethod,
        ranking: entry.ranking,
        isAvailable: entry.isAvailable,
        unavailableReason: entry.unavailableReason,
      },
    });
    return mapToPoolParticipant(row);
  }

  async createMany(
    entries: Omit<ContestParticipantPool, 'id' | 'createdAt' | 'updatedAt'>[],
  ): Promise<number> {
    const result = await this.prisma.contestParticipantPool.createMany({
      data: entries.map((e) => ({
        poolId: e.poolId,
        contestId: e.contestId,
        participantId: e.participantId,
        cost: e.cost,
        tier: e.tier,
        tierAssignmentMethod: e.tierAssignmentMethod,
        ranking: e.ranking,
        isAvailable: e.isAvailable,
        unavailableReason: e.unavailableReason,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async update(
    id: string,
    updates: Partial<ContestParticipantPool>,
  ): Promise<ContestParticipantPool> {
    const row = await this.prisma.contestParticipantPool.update({
      where: { id },
      data: {
        ...(updates.cost !== undefined && { cost: updates.cost }),
        ...(updates.tier !== undefined && { tier: updates.tier }),
        ...(updates.tierAssignmentMethod !== undefined && {
          tierAssignmentMethod: updates.tierAssignmentMethod,
        }),
        ...(updates.ranking !== undefined && { ranking: updates.ranking }),
        ...(updates.isAvailable !== undefined && { isAvailable: updates.isAvailable }),
        ...(updates.unavailableReason !== undefined && {
          unavailableReason: updates.unavailableReason,
        }),
      },
    });
    return mapToPoolParticipant(row);
  }

  async deleteByPool(poolId: string): Promise<number> {
    const result = await this.prisma.contestParticipantPool.deleteMany({
      where: { poolId },
    });
    return result.count;
  }
}

function mapToPoolParticipant(row: {
  id: string;
  poolId: string;
  contestId: string;
  participantId: string;
  cost: number | null;
  tier: string | null;
  tierAssignmentMethod: string | null;
  ranking: number | null;
  isAvailable: boolean;
  unavailableReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ContestParticipantPool {
  return {
    id: row.id,
    poolId: row.poolId,
    contestId: row.contestId,
    participantId: row.participantId,
    cost: row.cost ?? undefined,
    tier: row.tier ?? undefined,
    tierAssignmentMethod: (row.tierAssignmentMethod ?? undefined) as TierAssignmentMethod | undefined,
    ranking: row.ranking ?? undefined,
    isAvailable: row.isAvailable,
    unavailableReason: row.unavailableReason ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
