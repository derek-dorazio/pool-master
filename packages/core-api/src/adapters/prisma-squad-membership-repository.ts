import type { Prisma, PrismaClient, SquadMembership as PrismaSquadMembership } from '@prisma/client';
import type { LeagueUser, SquadMembershipRepository, SquadMembershipWithSquadName } from '@poolmaster/shared/db';
import type { SquadMembership, SquadMembershipStatus } from '@poolmaster/shared/domain';
import { SquadMembershipStatus as SharedSquadMembershipStatus } from '@poolmaster/shared/domain';
import { forgettingReads, memoizedRead, ReadMemoKey } from '../core/request-read-memo';

export class PrismaSquadMembershipRepository implements SquadMembershipRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async findBySquad(squadId: string, includeInactive = false): Promise<SquadMembership[]> {
    const rows = await this.prisma.squadMembership.findMany({
      where: {
        squadId,
        ...(includeInactive ? {} : { status: SharedSquadMembershipStatus.ACTIVE }),
      },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map(mapToSquadMembership);
  }

  async findBySquads(squadIds: readonly string[], includeInactive = false): Promise<SquadMembership[]> {
    if (squadIds.length === 0) return [];
    const rows = await this.prisma.squadMembership.findMany({
      where: {
        squadId: { in: [...squadIds] },
        ...(includeInactive ? {} : { status: SharedSquadMembershipStatus.ACTIVE }),
      },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(mapToSquadMembership);
  }

  async findBySquadAndUser(squadId: string, userId: string): Promise<SquadMembership | null> {
    const row = await this.prisma.squadMembership.findUnique({
      where: { squadId_userId: { squadId, userId } },
    });
    return row ? mapToSquadMembership(row) : null;
  }

  async findByLeagueAndUser(leagueId: string, userId: string): Promise<SquadMembership | null> {
    return memoizedRead(this.prisma, `${ReadMemoKey.squadMembership}${leagueId}:${userId}`, async () => {
      const row = await this.prisma.squadMembership.findUnique({
        where: { leagueId_userId: { leagueId, userId } },
      });
      return row ? mapToSquadMembership(row) : null;
    });
  }

  async findByLeagueAndUserWithSquadName(
    leagueId: string,
    userId: string,
  ): Promise<SquadMembershipWithSquadName | null> {
    const row = await this.prisma.squadMembership.findUnique({
      where: { leagueId_userId: { leagueId, userId } },
      include: { squad: { select: { name: true } } },
    });
    return row ? { ...mapToSquadMembership(row), squadName: row.squad.name } : null;
  }

  async findByLeagueUsersWithSquadName(people: readonly LeagueUser[]): Promise<SquadMembershipWithSquadName[]> {
    if (people.length === 0) return [];
    // An OR of the pairs, not a league list by a user list, which would match their cross product.
    const rows = await this.prisma.squadMembership.findMany({
      where: { OR: people.map(({ leagueId, userId }) => ({ leagueId, userId })) },
      include: { squad: { select: { name: true } } },
    });
    return rows.map((row) => ({ ...mapToSquadMembership(row), squadName: row.squad.name }));
  }

  async create(
    membership: Omit<SquadMembership, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SquadMembership> {
    const row = await forgettingReads(ReadMemoKey.squadMembership, () => this.prisma.squadMembership.create({
      data: {
        squadId: membership.squadId,
        leagueId: membership.leagueId,
        userId: membership.userId,
        status: membership.status,
        joinedAt: membership.joinedAt,
      },
    }));
    return mapToSquadMembership(row);
  }

  async update(id: string, updates: Partial<SquadMembership>): Promise<SquadMembership> {
    const row = await forgettingReads(ReadMemoKey.squadMembership, () => this.prisma.squadMembership.update({
      where: { id },
      data: {
        ...(updates.squadId !== undefined && { squadId: updates.squadId }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.joinedAt !== undefined && { joinedAt: updates.joinedAt }),
      },
    }));
    return mapToSquadMembership(row);
  }

}

export function mapToSquadMembership(row: PrismaSquadMembership): SquadMembership {
  return {
    id: row.id,
    squadId: row.squadId,
    leagueId: row.leagueId,
    userId: row.userId,
    status: row.status as SquadMembershipStatus,
    joinedAt: row.joinedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
