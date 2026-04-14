/**
 * Prisma adapter for LeagueRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { LeagueRepository } from '@poolmaster/shared/db';
import type { League } from '@poolmaster/shared/domain';

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

  async create(league: Omit<League, 'id' | 'createdAt' | 'updatedAt'>): Promise<League> {
    const row = await this.prisma.league.create({
      data: {
        leagueCode: league.leagueCode,
        name: league.name,
        description: league.description,
        createdBy: league.createdBy,
        isActive: league.isActive,
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
        ...(updates.joinPolicy !== undefined && { joinPolicy: updates.joinPolicy }),
      },
    });
    return mapToLeague(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.league.delete({ where: { id } });
  }
}

function mapToLeague(row: {
  id: string;
  leagueCode: string;
  name: string;
  description: string | null;
  createdBy: string;
  isActive: boolean;
  joinPolicy: string;
  createdAt: Date;
  updatedAt: Date;
}): League {
  return {
    id: row.id,
    leagueCode: row.leagueCode,
    name: row.name,
    description: row.description ?? undefined,
    createdBy: row.createdBy,
    isActive: row.isActive,
    joinPolicy: row.joinPolicy as League['joinPolicy'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
