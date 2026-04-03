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

  async findByMember(leagueMembershipId: string): Promise<ContestEntry[]> {
    const rows = await this.prisma.contestEntry.findMany({ where: { leagueMembershipId } });
    return rows.map(mapToEntry);
  }

  async create(entry: Omit<ContestEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContestEntry> {
    const row = await this.prisma.contestEntry.create({
      data: {
        contestId: entry.contestId,
        leagueMembershipId: entry.leagueMembershipId,
        name: entry.name,
        totalScore: entry.totalScore,
        rank: entry.rank,
        isEliminated: entry.isEliminated,
      },
    });
    return mapToEntry(row);
  }

  async update(id: string, updates: Partial<ContestEntry>): Promise<ContestEntry> {
    const row = await this.prisma.contestEntry.update({
      where: { id },
      data: {
        ...(updates.totalScore !== undefined && { totalScore: updates.totalScore }),
        ...(updates.rank !== undefined && { rank: updates.rank }),
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
  leagueMembershipId: string;
  name: string;
  totalScore: number;
  rank: number | null;
  isEliminated: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ContestEntry {
  return {
    id: row.id,
    contestId: row.contestId,
    leagueMembershipId: row.leagueMembershipId,
    name: row.name,
    totalScore: row.totalScore,
    rank: row.rank ?? undefined,
    isEliminated: row.isEliminated,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
