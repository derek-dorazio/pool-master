import type { PrismaClient } from '@prisma/client';
import type { SquadRepository } from '@poolmaster/shared/db';
import type { Squad } from '@poolmaster/shared/domain';

export class PrismaSquadRepository implements SquadRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Squad | null> {
    const row = await this.prisma.squad.findUnique({ where: { id } });
    return row ? mapToSquad(row) : null;
  }

  async findByLeague(leagueId: string, includeInactive = false): Promise<Squad[]> {
    const rows = await this.prisma.squad.findMany({
      where: {
        leagueId,
        ...(includeInactive ? {} : { status: 'ACTIVE' }),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapToSquad);
  }

  async create(squad: Omit<Squad, 'id' | 'createdAt' | 'updatedAt'>): Promise<Squad> {
    const row = await this.prisma.squad.create({
      data: {
        leagueId: squad.leagueId,
        createdBy: squad.createdBy,
        name: squad.name,
        iconUrl: squad.iconUrl,
        status: squad.status,
      },
    });
    return mapToSquad(row);
  }

  async update(id: string, updates: Partial<Squad>): Promise<Squad> {
    const row = await this.prisma.squad.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.iconUrl !== undefined && { iconUrl: updates.iconUrl }),
        ...(updates.status !== undefined && { status: updates.status }),
      },
    });
    return mapToSquad(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.squad.delete({ where: { id } });
  }
}

function mapToSquad(row: {
  id: string;
  leagueId: string;
  createdBy: string;
  name: string;
  iconUrl: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): Squad {
  return {
    id: row.id,
    leagueId: row.leagueId,
    createdBy: row.createdBy,
    name: row.name,
    iconUrl: row.iconUrl ?? undefined,
    status: row.status as Squad['status'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
