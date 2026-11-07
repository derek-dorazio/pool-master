/**
 * Prisma adapter for ProviderSyncRunRepository — the sync-run history the ledger writes and
 * the sync dashboard reads.
 */

import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type ProviderSyncRun as ProviderSyncRunRow } from '@prisma/client';
import type {
  ProviderSyncRunCreate,
  ProviderSyncRunFilters,
  ProviderSyncRunRepository,
  ProviderSyncRunUpdate,
} from '@poolmaster/shared/db';
import type { BackgroundJobRequest, ProviderSyncRun, ProviderSyncRunWithDetails } from '@poolmaster/shared/domain';
import { insertBackgroundJobs } from './prisma-background-job-repository';

export class PrismaProviderSyncRunRepository implements ProviderSyncRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: ProviderSyncRunCreate): Promise<ProviderSyncRun> {
    return toProviderSyncRun(await this.prisma.providerSyncRun.create({ data: toCreateData(input) }));
  }

  async createWithJob(
    inputs: readonly ProviderSyncRunCreate[],
    job: (runs: ProviderSyncRun[]) => BackgroundJobRequest,
  ): Promise<ProviderSyncRun[]> {
    // Ids chosen here, so the runs come back in the order given.
    const data = inputs.map((input) => ({ id: randomUUID(), ...toCreateData(input) }));
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.providerSyncRun.createManyAndReturn({ data, omit: { detailsJson: true } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const runs = data.map(({ id }) => {
        const row = byId.get(id);
        if (!row) throw new Error(`Sync run ${id} was not written`);
        return toProviderSyncRun(row);
      });
      await insertBackgroundJobs(tx, [job(runs)]);
      return runs;
    });
  }

  async findManyByIds(ids: readonly string[]): Promise<ProviderSyncRun[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.providerSyncRun.findMany({
      where: { id: { in: [...ids] } },
      omit: { detailsJson: true },
    });
    return rows.map(toProviderSyncRun);
  }

  async update(id: string, update: ProviderSyncRunUpdate): Promise<void> {
    await this.prisma.providerSyncRun.update({
      where: { id },
      data: {
        status: update.status,
        startedAt: update.startedAt,
        completedAt: update.completedAt,
        payloadJson: update.payload as Prisma.InputJsonValue,
        ...(update.details && { detailsJson: update.details as Prisma.InputJsonValue }),
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
      omit: { detailsJson: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toProviderSyncRun);
  }

  async findById(id: string): Promise<ProviderSyncRunWithDetails | null> {
    const row = await this.prisma.providerSyncRun.findUnique({ where: { id } });
    if (!row) return null;
    return {
      ...toProviderSyncRun(row),
      details: row.detailsJson === null ? null : toPayload(row.detailsJson),
    };
  }

  async clearDetailsBatchSubmittedBefore(before: Date, limit: number): Promise<number> {
    const batch = await this.prisma.providerSyncRun.findMany({
      where: { createdAt: { lt: before }, detailsJson: { not: Prisma.DbNull } },
      select: { id: true },
      take: limit,
    });
    if (batch.length === 0) return 0;
    const { count } = await this.prisma.providerSyncRun.updateMany({
      where: { id: { in: batch.map((row) => row.id) } },
      data: { detailsJson: Prisma.DbNull },
    });
    return count;
  }

  async deleteBatchSubmittedBefore(before: Date, limit: number): Promise<number> {
    const batch = await this.prisma.providerSyncRun.findMany({
      where: { createdAt: { lt: before } },
      select: { id: true },
      take: limit,
    });
    if (batch.length === 0) return 0;
    const { count } = await this.prisma.providerSyncRun.deleteMany({
      where: { id: { in: batch.map((row) => row.id) } },
    });
    return count;
  }
}

function toProviderSyncRun(row: Omit<ProviderSyncRunRow, 'detailsJson'>): ProviderSyncRun {
  return {
    id: row.id,
    providerId: row.providerId,
    sport: row.sport,
    eventId: row.eventId,
    status: row.status,
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
  return payload;
}

function toCreateData(input: ProviderSyncRunCreate) {
  return {
    providerId: input.providerId,
    sport: input.sport,
    eventId: input.eventId,
    status: input.status,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    payloadJson: input.payload as Prisma.InputJsonValue,
    ...(input.createdAt && { createdAt: input.createdAt }),
  };
}
