/**
 * Prisma adapter for ContestTimingPolicyRepository.
 */

import type { PrismaClient } from '@prisma/client';
import type { ContestTimingPolicyRepository } from '@poolmaster/shared/db';
import type { ContestTimingPolicy, Sport } from '@poolmaster/shared/domain';

export class PrismaContestTimingPolicyRepository implements ContestTimingPolicyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveBySport(sport: Sport): Promise<ContestTimingPolicy[]> {
    const rows = await this.prisma.contestTimingPolicy.findMany({
      where: { sport, active: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      sport: row.sport as Sport,
      eventType: row.eventType,
      contestFormat: row.contestFormat as ContestTimingPolicy['contestFormat'],
      releaseRule: row.releaseRule,
      fieldLockRule: row.fieldLockRule,
      isDefault: row.isDefault,
      active: row.active,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}
