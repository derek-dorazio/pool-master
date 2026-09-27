/**
 * Prisma adapter for LeagueRepository port.
 */

import type { League as PrismaLeague, Prisma, PrismaClient } from '@prisma/client';
import type { LeagueRepository, LeagueSearchFilters } from '@poolmaster/shared/db';
import type { JoinPolicy, League, LeagueIconKey } from '@poolmaster/shared/domain';

export class PrismaLeagueRepository implements LeagueRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<League | null> {
    const row = await this.prisma.league.findFirst({
      where: { id },
    });
    return row ? mapToLeague(row) : null;
  }

  async findByCode(code: string): Promise<League | null> {
    const row = await this.prisma.league.findFirst({
      where: { leagueCode: code },
    });
    return row ? mapToLeague(row) : null;
  }

  async findAll(filters: LeagueSearchFilters = {}): Promise<League[]> {
    const search = filters.search?.trim();
    const where: Prisma.LeagueWhereInput = {
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
      ...(typeof filters.isActive === 'boolean' ? { isActive: filters.isActive } : {}),
    };
    const rows = await this.prisma.league.findMany({
      where,
      // updatedAt first so the admin management surface shows recently-touched leagues at
      // the top, which is the ordering it already relied on.
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(mapToLeague);
  }

  async findByUser(userId: string): Promise<League[]> {
    // One join, replacing the service-level findByUser's membership fetch plus a findById
    // per membership (#202). A join cannot produce the orphaned-membership case that
    // version had to log and skip, because it only returns leagues that exist.
    const rows = await this.prisma.league.findMany({
      where: { memberships: { some: { userId } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapToLeague);
  }

  async create(league: Omit<League, 'id' | 'createdAt' | 'updatedAt'>): Promise<League> {
    const row = await this.prisma.league.create({
      data: {
        leagueCode: league.leagueCode,
        name: league.name,
        description: league.description,
        isActive: league.isActive,
        iconKey: league.iconKey,
        joinPolicy: league.joinPolicy,
      },
    });
    return mapToLeague(row);
  }

  async update(id: string, updates: Partial<League>): Promise<League> {
    const row = await this.prisma.league.update({
      where: { id },
      data: {
        ...(updates.leagueCode !== undefined && { leagueCode: updates.leagueCode }),
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
        ...(updates.iconKey !== undefined && { iconKey: updates.iconKey }),
        ...(updates.joinPolicy !== undefined && { joinPolicy: updates.joinPolicy }),
      },
    });
    return mapToLeague(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.league.delete({ where: { id } });
  }
}

function mapToLeague(row: PrismaLeague): League {
  return {
    id: row.id,
    leagueCode: row.leagueCode,
    name: row.name,
    description: row.description ?? undefined,
    isActive: row.isActive,
    iconKey: row.iconKey as LeagueIconKey,
    joinPolicy: row.joinPolicy as JoinPolicy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
