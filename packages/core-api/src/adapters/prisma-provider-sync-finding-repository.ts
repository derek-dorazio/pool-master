/**
 * Prisma adapter for ProviderSyncFindingRepository (#1999): the sync findings table, one row per
 * kind and subject (its NULLS NOT DISTINCT unique index is in the migration).
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  ProviderSyncFindingRepository,
  ProviderSyncFindingResolveFilter,
} from '@poolmaster/shared/db';
import {
  ProviderSyncFindingStatus,
  type ProviderSyncFinding,
  type ProviderSyncFindingOpened,
  type ProviderSyncFindingRaise,
  type ProviderSyncFindingSeverity,
  type ProviderSyncFindingStatusChange,
  type ProviderSyncFindingSubject,
} from '@poolmaster/shared/domain';

const FINDING_INCLUDE = {
  sportLeague: { select: { id: true, name: true, sport: { select: { sport: true } } } },
  sportEvent: { select: { id: true, name: true } },
  provider: { select: { id: true, name: true } },
  statusChangedBy: { select: { id: true, firstName: true, lastName: true, username: true, email: true } },
} as const satisfies Prisma.ProviderSyncFindingInclude;

type FindingRow = Prisma.ProviderSyncFindingGetPayload<{ include: typeof FINDING_INCLUDE }>;

/** A second writer can add the same subject between the read and the insert; the raise then tries once more. */
const RAISE_TRIES = 2;

export class PrismaProviderSyncFindingRepository implements ProviderSyncFindingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async raise(raises: readonly ProviderSyncFindingRaise[], seenAt: Date): Promise<ProviderSyncFindingOpened[]> {
    const bySubject = new Map(raises.map((raise) => [subjectKey(raise), raise]));
    if (bySubject.size === 0) return [];
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction((tx) => raiseIn(tx, [...bySubject.values()], seenAt));
      } catch (error) {
        if (attempt >= RAISE_TRIES || !isUniqueViolation(error)) throw error;
      }
    }
  }

  async resolveOpen(filter: ProviderSyncFindingResolveFilter, resolvedAt: Date): Promise<number> {
    const { count } = await this.prisma.providerSyncFinding.updateMany({
      where: {
        kind: filter.kind,
        status: ProviderSyncFindingStatus.OPEN,
        sportLeagueId: filter.exceptSportLeagueIds === undefined ? filter.sportLeagueId : { notIn: [...filter.exceptSportLeagueIds] },
        sportEventId: filter.sportEventId,
        providerId: filter.providerId,
        providerValue: providerValueWhere(filter),
      },
      data: { status: ProviderSyncFindingStatus.RESOLVED, statusChangedAt: resolvedAt, statusChangedByUserId: null },
    });
    return count;
  }

  async findAll(): Promise<ProviderSyncFinding[]> {
    const rows = await this.prisma.providerSyncFinding.findMany({
      include: FINDING_INCLUDE,
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map(toFinding);
  }

  async findById(id: string): Promise<ProviderSyncFinding | null> {
    const row = await this.prisma.providerSyncFinding.findUnique({ where: { id }, include: FINDING_INCLUDE });
    return row === null ? null : toFinding(row);
  }

  async setStatus(id: string, change: ProviderSyncFindingStatusChange): Promise<ProviderSyncFinding | null> {
    try {
      const row = await this.prisma.providerSyncFinding.update({
        where: { id },
        data: {
          status: change.status,
          waiveNote: change.waiveNote,
          statusChangedAt: change.changedAt,
          statusChangedByUserId: change.changedByUserId,
        },
        include: FINDING_INCLUDE,
      });
      return toFinding(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return null;
      throw error;
    }
  }

  async deleteResolvedBatchBefore(before: Date, limit: number): Promise<number> {
    const batch = await this.prisma.providerSyncFinding.findMany({
      where: { status: ProviderSyncFindingStatus.RESOLVED, statusChangedAt: { lt: before } },
      select: { id: true },
      orderBy: { statusChangedAt: 'asc' },
      take: limit,
    });
    if (batch.length === 0) return 0;
    const { count } = await this.prisma.providerSyncFinding.deleteMany({
      // Still resolved: one opened again since the read is kept.
      where: { id: { in: batch.map((row) => row.id) }, status: ProviderSyncFindingStatus.RESOLVED },
    });
    return count;
  }
}

/**
 * One read of the subjects already kept, one insert of the new ones, one update per severity for
 * the ones seen again, and one more to open the resolved among them.
 */
async function raiseIn(tx: Prisma.TransactionClient, raises: readonly ProviderSyncFindingRaise[], seenAt: Date): Promise<ProviderSyncFindingOpened[]> {
  const existing = await tx.providerSyncFinding.findMany({
    where: { OR: raises.map(subjectWhere) },
    select: { id: true, kind: true, sportLeagueId: true, sportEventId: true, providerId: true, providerValue: true, status: true },
  });
  const existingByKey = new Map(existing.map((row) => [subjectKey(row), row]));
  const fresh = raises.filter((raise) => !existingByKey.has(subjectKey(raise)));
  const created = fresh.length === 0 ? [] : await tx.providerSyncFinding.createManyAndReturn({
    data: fresh.map((raise) => ({
      kind: raise.kind,
      severity: raise.severity,
      status: ProviderSyncFindingStatus.OPEN,
      sportLeagueId: raise.sportLeagueId,
      sportEventId: raise.sportEventId,
      providerId: raise.providerId,
      providerValue: raise.providerValue,
      providerValueName: raise.providerValueName,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      statusChangedAt: seenAt,
    })),
    select: { id: true, kind: true, severity: true, sportLeagueId: true },
  });

  const seenAgain = raises.flatMap((raise) => {
    const row = existingByKey.get(subjectKey(raise));
    return row === undefined ? [] : [{ raise, row }];
  });
  const idsBySeverity = new Map<ProviderSyncFindingSeverity, string[]>();
  for (const { raise, row } of seenAgain) {
    idsBySeverity.set(raise.severity, [...(idsBySeverity.get(raise.severity) ?? []), row.id]);
  }
  for (const [severity, ids] of idsBySeverity) {
    // poolmaster-allow-query-in-loop: once per severity, three at most
    await tx.providerSyncFinding.updateMany({
      where: { id: { in: ids } },
      data: { severity, lastSeenAt: seenAt, seenCount: { increment: 1 } },
    });
  }
  const reopened = seenAgain.filter(({ row }) => row.status === ProviderSyncFindingStatus.RESOLVED);
  if (reopened.length > 0) {
    await tx.providerSyncFinding.updateMany({
      where: { id: { in: reopened.map(({ row }) => row.id) } },
      data: { status: ProviderSyncFindingStatus.OPEN, statusChangedAt: seenAt, statusChangedByUserId: null, waiveNote: null },
    });
  }
  return [
    ...created,
    ...reopened.map(({ raise, row }) => ({ id: row.id, kind: raise.kind, severity: raise.severity, sportLeagueId: raise.sportLeagueId })),
  ];
}

/** The values a resolve reaches: one, any of a list, or every one but a list (a null value is never "but" one). */
function providerValueWhere(filter: ProviderSyncFindingResolveFilter): Prisma.ProviderSyncFindingWhereInput['providerValue'] {
  if (filter.providerValues !== undefined) return { in: [...filter.providerValues] };
  if (filter.exceptProviderValues !== undefined) return { notIn: [...filter.exceptProviderValues] };
  return filter.providerValue;
}

function subjectWhere(subject: ProviderSyncFindingSubject): Prisma.ProviderSyncFindingWhereInput {
  return {
    kind: subject.kind,
    sportLeagueId: subject.sportLeagueId,
    sportEventId: subject.sportEventId,
    providerId: subject.providerId,
    providerValue: subject.providerValue,
  };
}

/** A subject's parts in a fixed order, to match raises against rows read back in this call. */
function subjectKey(subject: ProviderSyncFindingSubject): string {
  return JSON.stringify([subject.kind, subject.sportLeagueId, subject.sportEventId, subject.providerId, subject.providerValue]);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function toFinding(row: FindingRow): ProviderSyncFinding {
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    status: row.status,
    sportLeague: { id: row.sportLeague.id, name: row.sportLeague.name, sport: row.sportLeague.sport.sport },
    sportEvent: row.sportEvent,
    provider: row.provider,
    providerValue: row.providerValue,
    providerValueName: row.providerValueName,
    waiveNote: row.waiveNote,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    seenCount: row.seenCount,
    statusChangedAt: row.statusChangedAt,
    statusChangedBy: row.statusChangedBy,
  };
}
