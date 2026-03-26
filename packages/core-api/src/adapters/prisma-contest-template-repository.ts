/**
 * Prisma adapter for ContestTemplateRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { ContestTemplateRepository } from '@poolmaster/shared/db';
import type { ContestTemplate } from '@poolmaster/shared/domain';

export class PrismaContestTemplateRepository implements ContestTemplateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ContestTemplate | null> {
    const row = await this.prisma.contestTemplate.findUnique({ where: { id } });
    return row ? mapToTemplate(row) : null;
  }

  async findByLeague(leagueId: string): Promise<ContestTemplate[]> {
    const rows = await this.prisma.contestTemplate.findMany({
      where: { leagueId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(mapToTemplate);
  }

  async findPlatformTemplates(): Promise<ContestTemplate[]> {
    const rows = await this.prisma.contestTemplate.findMany({
      where: { isPlatformTemplate: true },
      orderBy: { sport: 'asc' },
    });
    return rows.map(mapToTemplate);
  }

  async create(
    template: Omit<ContestTemplate, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestTemplate> {
    const row = await this.prisma.contestTemplate.create({
      data: {
        leagueId: template.leagueId,
        createdBy: template.createdBy,
        name: template.name,
        description: template.description,
        sport: template.sport,
        contestType: template.contestType,
        draftConfig: template.draftConfig as object,
        scoringConfig: template.scoringConfig as object,
        payoutConfig: template.payoutConfig as object,
        poolConfig: template.poolConfig as object,
        sharedWithTenant: template.sharedWithTenant,
        isPlatformTemplate: template.isPlatformTemplate,
        timesUsed: template.timesUsed,
        lastUsedAt: template.lastUsedAt,
      },
    });
    return mapToTemplate(row);
  }

  async update(id: string, updates: Partial<ContestTemplate>): Promise<ContestTemplate> {
    const row = await this.prisma.contestTemplate.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.draftConfig !== undefined && { draftConfig: updates.draftConfig as object }),
        ...(updates.scoringConfig !== undefined && { scoringConfig: updates.scoringConfig as object }),
        ...(updates.payoutConfig !== undefined && { payoutConfig: updates.payoutConfig as object }),
        ...(updates.poolConfig !== undefined && { poolConfig: updates.poolConfig as object }),
        ...(updates.sharedWithTenant !== undefined && { sharedWithTenant: updates.sharedWithTenant }),
      },
    });
    return mapToTemplate(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.contestTemplate.delete({ where: { id } });
  }

  async incrementUsage(id: string): Promise<void> {
    await this.prisma.contestTemplate.update({
      where: { id },
      data: {
        timesUsed: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
  }
}

function mapToTemplate(row: {
  id: string;
  leagueId: string;
  createdBy: string;
  name: string;
  description: string | null;
  sport: string;
  contestType: string;
  draftConfig: unknown;
  scoringConfig: unknown;
  payoutConfig: unknown;
  poolConfig: unknown;
  sharedWithTenant: boolean;
  isPlatformTemplate: boolean;
  timesUsed: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ContestTemplate {
  return {
    id: row.id,
    leagueId: row.leagueId,
    createdBy: row.createdBy,
    name: row.name,
    description: row.description ?? undefined,
    sport: row.sport as ContestTemplate['sport'],
    contestType: row.contestType as ContestTemplate['contestType'],
    draftConfig: (row.draftConfig ?? {}) as Record<string, unknown>,
    scoringConfig: (row.scoringConfig ?? {}) as Record<string, unknown>,
    payoutConfig: (row.payoutConfig ?? {}) as Record<string, unknown>,
    poolConfig: (row.poolConfig ?? {}) as Record<string, unknown>,
    sharedWithTenant: row.sharedWithTenant,
    isPlatformTemplate: row.isPlatformTemplate,
    timesUsed: row.timesUsed,
    lastUsedAt: row.lastUsedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
