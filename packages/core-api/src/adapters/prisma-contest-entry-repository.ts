/**
 * Prisma adapter for ContestEntryRepository port.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  ContestEntryCreateResult,
  ContestEntryDeleteResult,
  ContestEntryRepository,
  ContestEntryWithSquad,
} from '@poolmaster/shared/db';
import type { ContestEntry, ContestEntryStatus } from '@poolmaster/shared/domain';
import { lockContestRow } from './contest-row-lock';

export class PrismaContestEntryRepository implements ContestEntryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByIdWithSquad(id: string): Promise<ContestEntryWithSquad | null> {
    const row = await this.prisma.contestEntry.findUnique({
      where: { id },
      include: { squad: { select: { name: true } } },
    });
    return row ? { ...mapToEntry(row), squadName: row.squad.name } : null;
  }

  async findByContestWithSquad(
    contestId: string,
    options?: { submittedOnly?: boolean },
  ): Promise<ContestEntryWithSquad[]> {
    const rows = await this.prisma.contestEntry.findMany({
      where: { contestId, ...(options?.submittedOnly && { status: 'SUBMITTED' }) },
      include: { squad: { select: { name: true } } },
      orderBy: [{ entryNumber: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => ({ ...mapToEntry(row), squadName: row.squad.name }));
  }

  async findByContest(contestId: string): Promise<ContestEntry[]> {
    // Creation order, then id — the order a selection room lists entries in (#324). Previously
    // unordered, so no caller could have depended on anything else.
    const rows = await this.prisma.contestEntry.findMany({
      where: { contestId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(mapToEntry);
  }

  async findBySquad(squadId: string): Promise<ContestEntry[]> {
    const rows = await this.prisma.contestEntry.findMany({ where: { squadId } });
    return rows.map(mapToEntry);
  }

  /** Refused once the contest is drawn; waits for a draw being recorded (#644). */
  async create(entry: Omit<ContestEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContestEntryCreateResult> {
    return this.prisma.$transaction(async (tx) => {
      await lockContestRow(tx, entry.contestId);
      if (await isContestDrawn(tx, entry.contestId)) return { status: 'contestDrawn' };
      const row = await tx.contestEntry.create({
        data: {
          contestId: entry.contestId,
          squadId: entry.squadId,
          entryNumber: entry.entryNumber,
          name: entry.name,
          status: entry.status,
          tiebreakerValue: entry.tiebreakerValue,
        },
      });
      return { status: 'created', entry: mapToEntry(row) };
    });
  }

  async update(id: string, updates: Partial<ContestEntry>): Promise<ContestEntry> {
    const row = await this.prisma.contestEntry.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.tiebreakerValue !== undefined && { tiebreakerValue: updates.tiebreakerValue }),
      },
    });
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

async function isContestDrawn(tx: Prisma.TransactionClient, contestId: string): Promise<boolean> {
  return (await tx.contestDraw.count({ where: { contestId } })) > 0;
}

function mapToEntry(row: {
  id: string;
  contestId: string;
  squadId: string;
  entryNumber: number;
  name: string;
  status: ContestEntryStatus;
  tiebreakerValue: number | null;
  createdAt: Date;
  updatedAt: Date;
}): ContestEntry {
  return {
    id: row.id,
    contestId: row.contestId,
    squadId: row.squadId,
    entryNumber: row.entryNumber,
    name: row.name,
    status: row.status,
    tiebreakerValue: row.tiebreakerValue ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
