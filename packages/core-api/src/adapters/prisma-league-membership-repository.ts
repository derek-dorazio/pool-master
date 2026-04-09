/**
 * Prisma adapter for LeagueMembershipRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { LeagueMembershipRepository } from '@poolmaster/shared/db';
import type {
  CommissionerPermission,
  LeagueMembership,
  LeagueMembershipStatus,
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
        permissions: membership.permissions as string[],
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
        ...(updates.permissions !== undefined && { permissions: updates.permissions as string[] }),
        ...(updates.joinedAt !== undefined && { joinedAt: updates.joinedAt }),
      },
    });
    return mapToMembership(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.leagueMembership.delete({ where: { id } });
  }
}

function mapToMembership(row: {
  id: string;
  leagueId: string;
  userId: string;
  role: string;
  status: string;
  permissions: unknown;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): LeagueMembership {
  return {
    id: row.id,
    leagueId: row.leagueId,
    userId: row.userId,
    role: row.role as LeagueMembership['role'],
    status: row.status as LeagueMembershipStatus,
    permissions: (Array.isArray(row.permissions) ? row.permissions : []) as CommissionerPermission[],
    joinedAt: row.joinedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
