/**
 * Prisma adapter for ProviderSyncRunRepository — the sync-run history the ledger writes and
 * the sync dashboard reads.
 */

import type { Prisma, PrismaClient, ProviderSyncRun as ProviderSyncRunRow } from '@prisma/client';
import type {
  ProviderSyncRunCreate,
  ProviderSyncRunFilters,
  ProviderSyncRunRepository,
  ProviderSyncRunUpdate,
} from '@poolmaster/shared/db';
import type { ProviderSyncRun, ProviderSyncRunStatus, Sport } from '@poolmaster/shared/domain';

export class PrismaProviderSyncRunRepository implements ProviderSyncRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: ProviderSyncRunCreate): Promise<ProviderSyncRun> {
    return toProviderSyncRun(await this.prisma.providerSyncRun.create({
      data: {
        providerId: input.providerId,
        sport: input.sport,
        eventId: input.eventId,
        status: input.status,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        payloadJson: input.payload as Prisma.InputJsonValue,
        ...(input.createdAt && { createdAt: input.createdAt }),
      },
    }));
  }

  async update(id: string, update: ProviderSyncRunUpdate): Promise<void> {
    await this.prisma.providerSyncRun.update({
      where: { id },
      data: {
        status: update.status,
        startedAt: update.startedAt,
        completedAt: update.completedAt,
        payloadJson: update.payload as Prisma.InputJsonValue,
      },
    });
  }

  async findAll(filters: ProviderSyncRunFilters): Promise<ProviderSyncRun[]> {
    // Each filter has a (column, created_at DESC) index; the unfiltered window has created_at's own.
    const rows = await this.prisma.providerSyncRun.findMany({
      where: {
        providerId: filters.providerId,
        sport: filters.sport,
        status: filters.status,
        createdAt: { gte: filters.createdFrom, lte: filters.createdTo },
      },
      orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toProviderSyncRun);
  }
}

function toProviderSyncRun(row: ProviderSyncRunRow): ProviderSyncRun {
  return {
    id: row.id,
    providerId: row.providerId,
    sport: row.sport as Sport,
    eventId: row.eventId,
    status: row.status as ProviderSyncRunStatus,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    payload: toPayload(row.payloadJson),
  };
}

function toPayload(payload: Prisma.JsonValue): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
}
