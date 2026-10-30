/**
 * Prisma adapter for LeagueMembershipRepository port.
 */

import type { LeagueMembership as PrismaLeagueMembership, Prisma, PrismaClient } from '@prisma/client';
import type { LeagueMembershipRepository } from '@poolmaster/shared/db';
import type {
  LeagueMembership,
  LeagueMembershipStatus,
  LeagueRole,
} from '@poolmaster/shared/domain';
import { LeagueMembershipStatus as MembershipStatus } from '@poolmaster/shared/domain';
import { forgettingReads, memoizedRead, ReadMemoKey } from '../core/request-read-memo';

export class PrismaLeagueMembershipRepository implements LeagueMembershipRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async findByLeague(leagueId: string): Promise<LeagueMembership[]> {
    const rows = await this.prisma.leagueMembership.findMany({
      where: { leagueId, status: MembershipStatus.ACTIVE },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map(mapToMembership);
  }

  async findByLeagues(leagueIds: readonly string[]): Promise<LeagueMembership[]> {
    if (leagueIds.length === 0) return [];
    const rows = await this.prisma.leagueMembership.findMany({
      where: { leagueId: { in: [...new Set(leagueIds)] }, status: MembershipStatus.ACTIVE },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(mapToMembership);
  }

  async countActiveByLeagues(leagueIds: string[]): Promise<Map<string, number>> {
    if (leagueIds.length === 0) {
      return new Map();
    }
    const grouped = await this.prisma.leagueMembership.groupBy({
      by: ['leagueId'],
      where: { leagueId: { in: leagueIds }, status: MembershipStatus.ACTIVE },
      _count: { _all: true },
    });
    return new Map(grouped.map((row) => [row.leagueId, row._count._all]));
  }

  async findByUser(userId: string): Promise<LeagueMembership[]> {
    const rows = await this.prisma.leagueMembership.findMany({
      where: { userId, status: MembershipStatus.ACTIVE },
      orderBy: { joinedAt: 'desc' },
    });
    return rows.map(mapToMembership);
  }

  /** Remembered for the request (#1176): the permission gate and the handler both ask for it. */
  async findByLeagueAndUser(leagueId: string, userId: string): Promise<LeagueMembership | null> {
    return memoizedRead(this.prisma, `${ReadMemoKey.leagueMembership}${leagueId}:${userId}`, async () => {
      const row = await this.prisma.leagueMembership.findUnique({
        where: { leagueId_userId: { leagueId, userId } },
      });
      return row ? mapToMembership(row) : null;
    });
  }

  async findActiveJoinedSince(since: Date): Promise<LeagueMembership[]> {
    const rows = await this.prisma.leagueMembership.findMany({
      where: { status: MembershipStatus.ACTIVE, joinedAt: { gte: since } },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(mapToMembership);
  }

  async create(
    membership: Omit<LeagueMembership, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<LeagueMembership> {
    const row = await forgettingReads(ReadMemoKey.leagueMembership, () => this.prisma.leagueMembership.create({
      data: {
        leagueId: membership.leagueId,
        userId: membership.userId,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joinedAt,
      },
    }));
    return mapToMembership(row);
  }

  async update(id: string, updates: Partial<LeagueMembership>): Promise<LeagueMembership> {
    const row = await forgettingReads(ReadMemoKey.leagueMembership, () => this.prisma.leagueMembership.update({
      where: { id },
      data: {
        ...(updates.role !== undefined && { role: updates.role }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.joinedAt !== undefined && { joinedAt: updates.joinedAt }),
      },
    }));
    return mapToMembership(row);
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
