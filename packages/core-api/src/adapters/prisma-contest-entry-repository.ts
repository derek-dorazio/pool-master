/**
 * Prisma adapter for ContestEntryRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { ContestEntryRepository } from '@poolmaster/shared/db';
import type { ContestEntry } from '@poolmaster/shared/domain';

export class PrismaContestEntryRepository implements ContestEntryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ContestEntry | null> {
    const row = await this.prisma.contestEntry.findUnique({ where: { id } });
    return row ? mapToEntry(row) : null;
  }

  async findByContest(contestId: string): Promise<ContestEntry[]> {
    const rows = await this.prisma.contestEntry.findMany({ where: { contestId } });
    return rows.map(mapToEntry);
  }

  async findBySquad(squadId: string): Promise<ContestEntry[]> {
    const rows = await this.prisma.contestEntry.findMany({ where: { squadId } });
    return rows.map(mapToEntry);
  }

  async create(entry: Omit<ContestEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContestEntry> {
    const row = await this.prisma.contestEntry.create({
      data: {
        contestId: entry.contestId,
        squadId: entry.squadId,
        entryNumber: entry.entryNumber,
        name: entry.name,
        status: entry.status,
        tiebreakerValue: entry.tiebreakerValue,
        totalScore: entry.totalScore,
        standingsPosition: entry.standingsPosition,
        isEliminated: entry.isEliminated,
      },
    });
    return mapToEntry(row);
  }

  async update(id: string, updates: Partial<ContestEntry>): Promise<ContestEntry> {
    const row = await this.prisma.contestEntry.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.tiebreakerValue !== undefined && { tiebreakerValue: updates.tiebreakerValue }),
        ...(updates.totalScore !== undefined && { totalScore: updates.totalScore }),
        ...(updates.standingsPosition !== undefined && {
          standingsPosition: updates.standingsPosition,
        }),
        ...(updates.isEliminated !== undefined && { isEliminated: updates.isEliminated }),
      },
    });
    return mapToEntry(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.contestEntry.delete({ where: { id } });
  }
}

function mapToEntry(row: {
  id: string;
  contestId: string;
  squadId: string;
  entryNumber: number;
  name: string;
  status: string;
  tiebreakerValue: number | null;
  totalScore: number;
  standingsPosition: number | null;
  isEliminated: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ContestEntry {
  return {
    id: row.id,
    contestId: row.contestId,
    squadId: row.squadId,
    entryNumber: row.entryNumber,
    name: row.name,
    status: row.status as ContestEntry['status'],
    tiebreakerValue: row.tiebreakerValue ?? undefined,
    totalScore: row.totalScore,
    standingsPosition: row.standingsPosition ?? undefined,
    isEliminated: row.isEliminated,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
