/**
 * Prisma adapter for LeagueRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { LeagueRepository } from '@poolmaster/shared/db';
import type { League } from '@poolmaster/shared/domain';

export class PrismaLeagueRepository implements LeagueRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string, tenantId: string): Promise<League | null> {
    const row = await this.prisma.league.findFirst({
      where: { id, tenantId },
    });
    return row ? mapToLeague(row) : null;
  }

  async findByTenant(tenantId: string): Promise<League[]> {
    const rows = await this.prisma.league.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapToLeague);
  }

  async create(league: Omit<League, 'id' | 'createdAt' | 'updatedAt'>): Promise<League> {
    const row = await this.prisma.league.create({
      data: {
        tenantId: league.tenantId,
        name: league.name,
        description: league.description,
        createdBy: league.createdBy,
        visibility: league.visibility,
        maxMembers: league.maxMembers,
        settings: league.settings as object,
      },
    });
    return mapToLeague(row);
  }

  async update(id: string, updates: Partial<League>): Promise<League> {
    const row = await this.prisma.league.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.visibility !== undefined && { visibility: updates.visibility }),
        ...(updates.maxMembers !== undefined && { maxMembers: updates.maxMembers }),
        ...(updates.settings !== undefined && { settings: updates.settings as object }),
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
  tenantId: string;
  name: string;
  description: string | null;
  createdBy: string;
  visibility: string;
  maxMembers: number;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
}): League {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description ?? undefined,
    createdBy: row.createdBy,
    visibility: row.visibility as League['visibility'],
    maxMembers: row.maxMembers,
    settings: (row.settings ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
