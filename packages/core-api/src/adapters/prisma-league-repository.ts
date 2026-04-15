/**
 * Prisma adapter for LeagueRepository port.
 */

import type { League as PrismaLeague, PrismaClient } from '@prisma/client';
import type { LeagueRepository } from '@poolmaster/shared/db';
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

  async findAll(): Promise<League[]> {
    const rows = await this.prisma.league.findMany({
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
        createdBy: league.createdBy,
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
    createdBy: row.createdBy,
    isActive: row.isActive,
    iconKey: row.iconKey as LeagueIconKey,
    joinPolicy: row.joinPolicy as JoinPolicy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
