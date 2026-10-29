import type { Prisma, PrismaClient, Squad as PrismaSquad } from '@prisma/client';
import type { SquadDetails, SquadRepository } from '@poolmaster/shared/db';
import type { Squad, TeamIconKey } from '@poolmaster/shared/domain';
import { mapToSquadMembership } from './prisma-squad-membership-repository';
import { mapToUser } from './prisma-user-repository';

/**
 * A squad's owners, in join order, each with their user and their role in the squad's league
 * (#1165, #1202). Prisma reads the relation in one statement per level for however many squads
 * match, so a league's whole team list is four statements rather than four per team.
 * `passwordHash` is never read for an embedded user.
 *
 * `leagueMembership` picks the owner's one membership in the squad's league
 * (`@@unique([leagueId, userId])`); a team page names a commissioner owner from it rather than
 * reading the league's whole roster.
 */
function squadDetailsInclude(leagueMembership: Prisma.LeagueMembershipWhereInput) {
  return {
    memberships: {
      orderBy: { joinedAt: 'asc' },
      include: {
        user: {
          omit: { passwordHash: true },
          include: { memberships: { where: leagueMembership, select: { role: true } } },
        },
      },
    },
  } satisfies Prisma.SquadInclude;
}

type SquadDetailsRow = Prisma.SquadGetPayload<{ include: ReturnType<typeof squadDetailsInclude> }>;

export class PrismaSquadRepository implements SquadRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async findById(id: string): Promise<Squad | null> {
    const row = await this.prisma.squad.findUnique({ where: { id } });
    return row ? mapToSquad(row) : null;
  }

  async findByLeague(leagueId: string, includeInactive = false): Promise<Squad[]> {
    const rows = await this.prisma.squad.findMany({
      where: {
        leagueId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapToSquad);
  }

  async findDetailsById(id: string): Promise<SquadDetails | null> {
    const row = await this.prisma.squad.findUnique({
      where: { id },
      include: squadDetailsInclude({ league: { squads: { some: { id } } } }),
    });
    return row ? mapToSquadDetails(row) : null;
  }

  async findDetailsByLeague(leagueId: string): Promise<SquadDetails[]> {
    const rows = await this.prisma.squad.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'asc' },
      include: squadDetailsInclude({ leagueId }),
    });
    return rows.map(mapToSquadDetails);
  }

  async countActiveByLeague(leagueId: string): Promise<number> {
    return this.prisma.squad.count({ where: { leagueId, isActive: true } });
  }

  async findByLeagueAndName(leagueId: string, name: string): Promise<Squad | null> {
    // Resolves against the @@unique([leagueId, name]) index, so at most one row, and
    // deliberately unfiltered by isActive — the constraint covers inactive squads too.
    const row = await this.prisma.squad.findUnique({
      where: { leagueId_name: { leagueId, name } },
    });
    return row ? mapToSquad(row) : null;
  }

  async create(squad: Omit<Squad, 'id' | 'createdAt' | 'updatedAt'>): Promise<Squad> {
    const row = await this.prisma.squad.create({
      data: {
        leagueId: squad.leagueId,
        createdBy: squad.createdBy,
        name: squad.name,
        iconKey: squad.iconKey,
        isActive: squad.isActive,
      },
    });
    return mapToSquad(row);
  }

  async update(id: string, updates: Partial<Squad>): Promise<Squad> {
    const row = await this.prisma.squad.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.iconKey !== undefined && { iconKey: updates.iconKey }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
      },
    });
    return mapToSquad(row);
  }

}

function mapToSquad(row: PrismaSquad): Squad {
  return {
    id: row.id,
    leagueId: row.leagueId,
    createdBy: row.createdBy,
    name: row.name,
    iconKey: row.iconKey as TeamIconKey,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapToSquadDetails(row: SquadDetailsRow): SquadDetails {
  return {
    ...mapToSquad(row),
    members: row.memberships.map((membership) => ({
      membership: mapToSquadMembership(membership),
      user: mapToUser(membership.user),
      leagueRole: membership.user.memberships[0]?.role ?? null,
    })),
  };
}
