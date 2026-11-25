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
import { ProviderSyncRunStatus, type BackgroundJobRequest, type ProviderSyncRun, type ProviderSyncRunCounts, type ProviderSyncRunOutcome, type ProviderSyncRunWithDetails } from '@poolmaster/shared/domain';
import { insertBackgroundJobs } from './prisma-background-job-repository';

export class PrismaProviderSyncRunRepository implements ProviderSyncRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: ProviderSyncRunCreate): Promise<ProviderSyncRun> {
    // One write: the Provider row and the event are reached by their keys.
    const { providerCode, sportEventId, ...data } = toCreateData(input);
    return toProviderSyncRun(await this.prisma.providerSyncRun.create({
      data: {
        ...data,
        provider: { connect: { code: providerCode } },
        ...(sportEventId !== null && { sportEvent: { connect: { id: sportEventId } } }),
      },
      include: RUN_RELATIONS,
    }));
  }

  async createWithJob(
    inputs: readonly ProviderSyncRunCreate[],
    job: (runs: ProviderSyncRun[]) => BackgroundJobRequest,
  ): Promise<ProviderSyncRun[]> {
    // Ids chosen here, so the runs come back in the order given.
    const inputsWithIds = inputs.map((input) => ({ id: randomUUID(), ...toCreateData(input) }));
    return this.prisma.$transaction(async (tx) => {
      // Each run is keyed to its Provider row (#2040), read once by code.
      const providerIds = new Map((await tx.provider.findMany({
        where: { code: { in: [...new Set(inputsWithIds.map((input) => input.providerCode))] } },
        select: { id: true, code: true },
      })).map((provider) => [provider.code, provider.id]));
      const data = inputsWithIds.map(({ providerCode, ...input }) => {
        const providerId = providerIds.get(providerCode);
        if (providerId === undefined) throw new Error(`Provider ${providerCode} has no Provider row`);
        return { ...input, providerId };
      });
      const rows = await tx.providerSyncRun.createManyAndReturn({ data, omit: { detailsJson: true }, include: RUN_RELATIONS });
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
      include: RUN_RELATIONS,
    });
    return rows.map(toProviderSyncRun);
  }

  async findByBackgroundJobIds(backgroundJobIds: readonly string[]): Promise<ProviderSyncRun[]> {
    if (backgroundJobIds.length === 0) return [];
    const rows = await this.prisma.providerSyncRun.findMany({
      where: { backgroundJobId: { in: [...backgroundJobIds] } },
      omit: { detailsJson: true },
      include: RUN_RELATIONS,
      orderBy: { createdAt: 'asc' },
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
        ...outcomeData(update),
        ...(update.details && { detailsJson: update.details as Prisma.InputJsonValue }),
        ...(update.backgroundJobId !== undefined && { backgroundJobId: update.backgroundJobId }),
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
      include: RUN_RELATIONS,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toProviderSyncRun);
  }

  async findById(id: string): Promise<ProviderSyncRunWithDetails | null> {
    const row = await this.prisma.providerSyncRun.findUnique({ where: { id }, include: RUN_RELATIONS });
    if (!row) return null;
    return {
      ...toProviderSyncRun(row),
      details: row.detailsJson === null ? null : toDetails(row.detailsJson),
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

  async countFinishedByProvider(since: Date): Promise<ProviderSyncRunCounts[]> {
    // One grouped read over the window, on the created_at index.
    const groups = await this.prisma.providerSyncRun.groupBy({
      by: ['providerId', 'status'],
      where: { createdAt: { gte: since }, status: { in: [ProviderSyncRunStatus.COMPLETED, ProviderSyncRunStatus.FAILED] } },
      _count: { _all: true },
    });
    const counts = new Map<string, ProviderSyncRunCounts>();
    for (const group of groups) {
      const entry = counts.get(group.providerId) ?? { providerId: group.providerId, finished: 0, failed: 0 };
      entry.finished += group._count._all;
      if (group.status === ProviderSyncRunStatus.FAILED) entry.failed += group._count._all;
      counts.set(group.providerId, entry);
    }
    return [...counts.values()];
  }
}

/** What a run reads with its row (#2040): its Provider's name, and its event's id at the provider. */
const RUN_RELATIONS = {
  provider: { select: { name: true } },
  sportEvent: { select: { providerMappings: { select: { providerId: true, externalId: true } } } },
} as const;

type RunRow = Omit<ProviderSyncRunRow, 'detailsJson'> & {
  provider: { name: string };
  sportEvent: { providerMappings: Array<{ providerId: string; externalId: string }> } | null;
};

function toProviderSyncRun(row: RunRow): ProviderSyncRun {
  return {
    id: row.id,
    providerId: row.providerId,
    providerName: row.provider.name,
    sport: row.sport,
    eventId: row.sportEvent?.providerMappings.find((mapping) => mapping.providerId === row.providerId)?.externalId ?? null,
    kind: row.kind,
    trigger: row.trigger,
    sportLeagueId: row.sportLeagueId,
    sportEventId: row.sportEventId,
    backgroundJobId: row.backgroundJobId,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    summary: row.summary,
    stats: toStats(row.stats),
    changedCount: row.changedCount,
    errorCount: row.errorCount,
  };
}

function toDetails(details: Prisma.JsonValue): Record<string, unknown> {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  return details;
}

/** The run's outcome columns, as a write sets them. */
function outcomeData(outcome: ProviderSyncRunOutcome) {
  return {
    summary: outcome.summary,
    stats: outcome.stats,
    changedCount: outcome.changedCount,
    errorCount: outcome.errorCount,
  };
}

/** The stats column holds numbers by name; anything else in it is left out. */
function toStats(stats: Prisma.JsonValue): Record<string, number> {
  if (stats === null || typeof stats !== 'object' || Array.isArray(stats)) return {};
  return Object.fromEntries(Object.entries(stats).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
}

function toCreateData(input: ProviderSyncRunCreate) {
  return {
    providerCode: input.providerCode,
    sport: input.sport,
    kind: input.kind,
    trigger: input.trigger,
    sportLeagueId: input.sportLeagueId,
    sportEventId: input.sportEventId,
    backgroundJobId: input.backgroundJobId,
    status: input.status,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    ...outcomeData(input),
    ...(input.createdAt && { createdAt: input.createdAt }),
  };
}
