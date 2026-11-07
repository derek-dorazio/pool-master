/**
 * Prisma adapter for LeagueMembershipRepository port.
 */

import type { LeagueMembership as PrismaLeagueMembership, Prisma, PrismaClient } from '@prisma/client';
import type { LeagueMembershipRepository, MembershipReadOptions } from '@poolmaster/shared/db';
import type {
  LeagueMembership,
  LeagueRole,
} from '@poolmaster/shared/domain';
import { LeagueMembershipStatus as MembershipStatus } from '@poolmaster/shared/domain';
import { leagueMembershipCache, type LeagueMembershipCache } from '../core/league-membership-cache';
import { forgettingReads, isRootClient, memoizedRead, ReadMemoKey } from '../core/request-read-memo';

export class PrismaLeagueMembershipRepository implements LeagueMembershipRepository {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
    private readonly cache: LeagueMembershipCache = leagueMembershipCache,
  ) {}

  async findByLeague(leagueId: string): Promise<LeagueMembership[]> {
    const rows = await this.prisma.leagueMembership.findMany({
      where: { leagueId, status: MembershipStatus.ACTIVE },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map(mapToMembership);
  }

  async findByLeagues(leagueIds: readonly string[], roles?: readonly LeagueRole[]): Promise<LeagueMembership[]> {
    if (leagueIds.length === 0) return [];
    const rows = await this.prisma.leagueMembership.findMany({
      where: { leagueId: { in: [...new Set(leagueIds)] }, status: MembershipStatus.ACTIVE, ...(roles && { role: { in: [...roles] } }) },
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

  /**
   * Remembered for the request (#1176): the permission gate and the handler both ask for it.
   * An ACTIVE membership is also kept by this task for the cache's TTL (#1438); "not a member"
   * never is. A read through a transaction sees its own rows, so it skips both. `fresh` skips the
   * cache for a precondition that decides a write, so a member who left on another task can rejoin
   * here at once; it is remembered for the request under its own key.
   */
  async findByLeagueAndUser(leagueId: string, userId: string, options?: MembershipReadOptions): Promise<LeagueMembership | null> {
    const load = async () => {
      const row = await this.prisma.leagueMembership.findUnique({
        where: { leagueId_userId: { leagueId, userId } },
      });
      return row ? mapToMembership(row) : null;
    };
    if (!isRootClient(this.prisma)) {
      return load();
    }
    if (options?.fresh) {
      return memoizedRead(this.prisma, `${ReadMemoKey.leagueMembership}fresh:${leagueId}:${userId}`, load);
    }
    return memoizedRead(this.prisma, `${ReadMemoKey.leagueMembership}${leagueId}:${userId}`, () =>
      this.cache.read(leagueId, userId, load));
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
    const row = await this.cache.writing(() => forgettingReads(ReadMemoKey.leagueMembership, () => this.prisma.leagueMembership.create({
      data: {
        leagueId: membership.leagueId,
        userId: membership.userId,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joinedAt,
      },
    })));
    this.cache.forget(row.leagueId, row.userId);
    return mapToMembership(row);
  }

  async update(id: string, updates: Partial<LeagueMembership>): Promise<LeagueMembership> {
    const row = await this.cache.writing(() => forgettingReads(ReadMemoKey.leagueMembership, () => this.prisma.leagueMembership.update({
      where: { id },
      data: {
        ...(updates.role !== undefined && { role: updates.role }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.joinedAt !== undefined && { joinedAt: updates.joinedAt }),
      },
    })));
    // A role change or a leave/removal: this task stops granting the old access at once (#1438).
    this.cache.forget(row.leagueId, row.userId);
    return mapToMembership(row);
  }

}

function mapToMembership(row: PrismaLeagueMembership): LeagueMembership {
  return {
    id: row.id,
    leagueId: row.leagueId,
    userId: row.userId,
    role: row.role,
    status: row.status,
    joinedAt: row.joinedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
