/**
 * Prisma adapter for ContestEntryRepository port.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  ContestEntryCreate,
  ContestEntryCreateLimits,
  ContestEntryCreateResult,
  ContestEntryDeleteResult,
  ContestEntryRepository,
  ContestEntryWithSquad,
  StandingsEmailPosition,
  StandingsEmailPositionRepository,
} from '@poolmaster/shared/db';
import type { ContestEntry, ContestEntryStatus } from '@poolmaster/shared/domain';
import { lockContestRow } from './contest-row-lock';

/** Every entry read carries its status in each of its contest's events (#713). */
const ENTRY_EVENTS = { events: { select: { sportEventId: true, status: true, submittedAt: true, tiebreakerValue: true } } } as const;

export class PrismaContestEntryRepository implements ContestEntryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByIdWithSquad(id: string): Promise<ContestEntryWithSquad | null> {
    const row = await this.prisma.contestEntry.findUnique({
      where: { id },
      include: { squad: { select: { name: true } }, ...ENTRY_EVENTS },
    });
    return row ? { ...mapToEntry(row), squadName: row.squad.name } : null;
  }

  async findByContestWithSquad(
    contestId: string,
    options?: { submittedFor?: string },
  ): Promise<ContestEntryWithSquad[]> {
    const rows = await this.prisma.contestEntry.findMany({
      where: {
        contestId,
        ...(options?.submittedFor !== undefined && {
          events: { some: { sportEventId: options.submittedFor, status: 'SUBMITTED' } },
        }),
      },
      include: { squad: { select: { name: true } }, ...ENTRY_EVENTS },
      orderBy: [{ entryNumber: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => ({ ...mapToEntry(row), squadName: row.squad.name }));
  }

  async countByContests(contestIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map(contestIds.map((contestId) => [contestId, 0]));
    if (!contestIds.length) return counts;
    const rows = await this.prisma.contestEntry.groupBy({
      by: ['contestId'],
      where: { contestId: { in: [...contestIds] } },
      _count: { _all: true },
    });
    for (const row of rows) counts.set(row.contestId, row._count._all);
    return counts;
  }

  async findByContest(contestId: string): Promise<ContestEntry[]> {
    // Creation order, then id — the order a selection room lists entries in (#324). Previously
    // unordered, so no caller could have depended on anything else.
    const rows = await this.prisma.contestEntry.findMany({
      where: { contestId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: ENTRY_EVENTS,
    });
    return rows.map(mapToEntry);
  }

  async findBySquad(squadId: string): Promise<ContestEntry[]> {
    const rows = await this.prisma.contestEntry.findMany({ where: { squadId }, include: ENTRY_EVENTS });
    return rows.map(mapToEntry);
  }

  /** Refused once the contest is drawn or full; waits for a draw being recorded (#644). */
  async create(entry: ContestEntryCreate, limits: ContestEntryCreateLimits): Promise<ContestEntryCreateResult> {
    return this.prisma.$transaction(async (tx) => {
      await lockContestRow(tx, entry.contestId);
      if (await isContestDrawn(tx, entry.contestId)) return { status: 'contestDrawn' };
      // Counted under the lock: every entry, drafts included (#947).
      if (limits.entriesPerContest !== null
        && await tx.contestEntry.count({ where: { contestId: entry.contestId } }) >= limits.entriesPerContest) {
        return { status: 'contestFull' };
      }
      // Read under the lock, so an event added meanwhile is either here or given to the entry by
      // the event change that runs after (`replaceSportEvents`).
      const contestEvents = await tx.contestSportEvent.findMany({
        where: { contestId: entry.contestId },
        select: { sportEventId: true },
      });
      const row = await tx.contestEntry.create({
        data: {
          contestId: entry.contestId,
          squadId: entry.squadId,
          entryNumber: entry.entryNumber,
          name: entry.name,
          tiebreakerValue: entry.tiebreakerValue,
          events: { create: contestEvents.map(({ sportEventId }) => ({ sportEventId })) },
        },
        include: ENTRY_EVENTS,
      });
      return { status: 'created', entry: mapToEntry(row) };
    });
  }

  async update(id: string, updates: Partial<Pick<ContestEntry, 'name' | 'tiebreakerValue'>>): Promise<ContestEntry> {
    const row = await this.prisma.contestEntry.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.tiebreakerValue !== undefined && { tiebreakerValue: updates.tiebreakerValue }),
      },
      include: ENTRY_EVENTS,
    });
    return mapToEntry(row);
  }

  async setEventStatus(id: string, sportEventId: string, status: ContestEntryStatus, at: Date): Promise<ContestEntry> {
    const submittedAt = status === 'SUBMITTED' ? at : null;
    await this.prisma.contestEntryEvent.upsert({
      where: { contestEntryId_sportEventId: { contestEntryId: id, sportEventId } },
      create: { contestEntryId: id, sportEventId, status, submittedAt },
      update: { status, submittedAt },
    });
    const row = await this.prisma.contestEntry.findUniqueOrThrow({ where: { id }, include: ENTRY_EVENTS });
    return mapToEntry(row);
  }

  /** Refused once the contest is drawn; waits for a draw being recorded (#644). */
  async delete(id: string): Promise<ContestEntryDeleteResult> {
    return this.prisma.$transaction(async (tx) => {
      const { contestId } = await tx.contestEntry.findUniqueOrThrow({ where: { id }, select: { contestId: true } });
      await lockContestRow(tx, contestId);
      if (await isContestDrawn(tx, contestId)) return { status: 'contestDrawn' };
      await tx.contestEntry.delete({ where: { id } });
      return { status: 'deleted' };
    });
  }
}

/** Whether the contest is drawn: a random draw has dealt (#601), or squares' digits are drawn (#711). */
async function isContestDrawn(tx: Prisma.TransactionClient, contestId: string): Promise<boolean> {
  const [deals, digits] = await Promise.all([
    tx.contestDraw.count({ where: { contestId } }),
    tx.contestSquaresDraw.count({ where: { contestId } }),
  ]);
  return deals + digits > 0;
}

/** Prisma adapter for StandingsEmailPositionRepository: the place is a column on the entry (#877). */
export class PrismaStandingsEmailPositionRepository implements StandingsEmailPositionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByContest(contestId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.contestEntry.findMany({
      where: { contestId, lastStandingsEmailPosition: { not: null } },
      select: { id: true, lastStandingsEmailPosition: true },
    });
    return new Map(rows.flatMap((row) => row.lastStandingsEmailPosition === null ? [] : [[row.id, row.lastStandingsEmailPosition]]));
  }

  /**
   * One statement for the whole board, and raw so the entry's `updated_at` stays as it was: a
   * standings email changes nothing about the entry, and its receipts read that time.
   */
  async record(positions: readonly StandingsEmailPosition[]): Promise<void> {
    if (positions.length === 0) return;
    const ids = positions.map((row) => row.contestEntryId);
    const places = positions.map((row) => row.position);
    await this.prisma.$executeRaw`
      UPDATE "contest_entries" AS entry
      SET "last_standings_email_position" = placed.position
      FROM unnest(${ids}::uuid[], ${places}::int[]) AS placed(id, position)
      WHERE entry.id = placed.id`;
  }
}

function mapToEntry(row: {
  id: string;
  contestId: string;
  squadId: string;
  entryNumber: number;
  name: string;
  tiebreakerValue: number | null;
  events: { sportEventId: string; status: ContestEntryStatus; submittedAt: Date | null; tiebreakerValue: number | null }[];
  createdAt: Date;
  updatedAt: Date;
}): ContestEntry {
  return {
    id: row.id,
    contestId: row.contestId,
    squadId: row.squadId,
    entryNumber: row.entryNumber,
    name: row.name,
    tiebreakerValue: row.tiebreakerValue ?? undefined,
    events: row.events.map((event) => ({
      sportEventId: event.sportEventId,
      status: event.status,
      submittedAt: event.submittedAt ?? undefined,
      tiebreakerValue: event.tiebreakerValue ?? undefined,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
