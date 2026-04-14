/**
 * Prisma adapter for LeagueMembershipRepository port.
 */

import type { LeagueMembership as PrismaLeagueMembership, PrismaClient } from '@prisma/client';
import type { LeagueMembershipRepository } from '@poolmaster/shared/db';
import type {
  LeagueMembership,
  LeagueMembershipStatus,
  LeagueRole,
} from '@poolmaster/shared/domain';
import { LeagueMembershipStatus as MembershipStatus } from '@poolmaster/shared/domain';

export class PrismaLeagueMembershipRepository implements LeagueMembershipRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByLeague(leagueId: string): Promise<LeagueMembership[]> {
    const rows = await this.prisma.leagueMembership.findMany({
      where: { leagueId, status: MembershipStatus.ACTIVE },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map(mapToMembership);
  }

  async findByUser(userId: string): Promise<LeagueMembership[]> {
    const rows = await this.prisma.leagueMembership.findMany({
      where: { userId, status: MembershipStatus.ACTIVE },
      orderBy: { joinedAt: 'desc' },
    });
    return rows.map(mapToMembership);
  }

  async findByLeagueAndUser(leagueId: string, userId: string): Promise<LeagueMembership | null> {
    const row = await this.prisma.leagueMembership.findUnique({
      where: { leagueId_userId: { leagueId, userId } },
    });
    return row ? mapToMembership(row) : null;
  }

  async create(
    membership: Omit<LeagueMembership, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<LeagueMembership> {
    const row = await this.prisma.leagueMembership.create({
      data: {
        leagueId: membership.leagueId,
        userId: membership.userId,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joinedAt,
      },
    });
    return mapToMembership(row);
  }

  async update(id: string, updates: Partial<LeagueMembership>): Promise<LeagueMembership> {
    const row = await this.prisma.leagueMembership.update({
      where: { id },
      data: {
        ...(updates.role !== undefined && { role: updates.role }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.joinedAt !== undefined && { joinedAt: updates.joinedAt }),
      },
    });
    return mapToMembership(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.leagueMembership.delete({ where: { id } });
  }
}

function mapToMembership(row: PrismaLeagueMembership): LeagueMembership {
  return {
    id: row.id,
    leagueId: row.leagueId,
    userId: row.userId,
    role: row.role as LeagueRole,
    status: row.status as LeagueMembershipStatus,
    joinedAt: row.joinedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
