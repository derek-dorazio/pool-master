import type { PrismaClient } from '@prisma/client';
import type { SquadMembershipRepository } from '@poolmaster/shared/db';
import type { SquadMembership } from '@poolmaster/shared/domain';

export class PrismaSquadMembershipRepository implements SquadMembershipRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySquad(squadId: string, includeInactive = false): Promise<SquadMembership[]> {
    const rows = await this.prisma.squadMembership.findMany({
      where: {
        squadId,
        ...(includeInactive ? {} : { status: 'ACTIVE' }),
      },
      orderBy: { joinedAt: 'asc' },
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
    const row = await this.prisma.squadMembership.findUnique({
      where: { leagueId_userId: { leagueId, userId } },
    });
    return row ? mapToSquadMembership(row) : null;
  }

  async create(
    membership: Omit<SquadMembership, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SquadMembership> {
    const row = await this.prisma.squadMembership.create({
      data: {
        squadId: membership.squadId,
        leagueId: membership.leagueId,
        userId: membership.userId,
        status: membership.status,
        joinedAt: membership.joinedAt,
      },
    });
    return mapToSquadMembership(row);
  }

  async update(id: string, updates: Partial<SquadMembership>): Promise<SquadMembership> {
    const row = await this.prisma.squadMembership.update({
      where: { id },
      data: {
        ...(updates.squadId !== undefined && { squadId: updates.squadId }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.joinedAt !== undefined && { joinedAt: updates.joinedAt }),
      },
    });
    return mapToSquadMembership(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.squadMembership.delete({ where: { id } });
  }
}

function mapToSquadMembership(row: {
  id: string;
  squadId: string;
  leagueId: string;
  userId: string;
  status: string;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): SquadMembership {
  return {
    id: row.id,
    squadId: row.squadId,
    leagueId: row.leagueId,
    userId: row.userId,
    status: row.status as SquadMembership['status'],
    joinedAt: row.joinedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
