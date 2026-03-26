/**
 * Prisma adapter for ActionItemRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { ActionItemRepository } from '@poolmaster/shared/db';
import type { ActionItem } from '@poolmaster/shared/domain';

export class PrismaActionItemRepository implements ActionItemRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByLeague(leagueId: string, includeResolved = false): Promise<ActionItem[]> {
    const rows = await this.prisma.commissionerActionItem.findMany({
      where: { leagueId, ...(!includeResolved && { resolved: false }) },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map(mapToActionItem);
  }

  async findUnresolved(leagueId: string): Promise<ActionItem[]> {
    return this.findByLeague(leagueId, false);
  }

  async create(item: Omit<ActionItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<ActionItem> {
    const row = await this.prisma.commissionerActionItem.create({
      data: {
        leagueId: item.leagueId,
        contestId: item.contestId,
        type: item.type,
        priority: item.priority,
        title: item.title,
        description: item.description,
        actionUrl: item.actionUrl,
        resolved: item.resolved,
        resolvedAt: item.resolvedAt,
      },
    });
    return mapToActionItem(row);
  }

  async resolve(id: string): Promise<ActionItem> {
    const row = await this.prisma.commissionerActionItem.update({
      where: { id },
      data: { resolved: true, resolvedAt: new Date() },
    });
    return mapToActionItem(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.commissionerActionItem.delete({ where: { id } });
  }
}

function mapToActionItem(row: {
  id: string;
  leagueId: string;
  contestId: string | null;
  type: string;
  priority: string;
  title: string;
  description: string | null;
  actionUrl: string | null;
  resolved: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ActionItem {
  return {
    id: row.id,
    leagueId: row.leagueId,
    contestId: row.contestId ?? undefined,
    type: row.type as ActionItem['type'],
    priority: row.priority as ActionItem['priority'],
    title: row.title,
    description: row.description ?? undefined,
    actionUrl: row.actionUrl ?? undefined,
    resolved: row.resolved,
    resolvedAt: row.resolvedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
