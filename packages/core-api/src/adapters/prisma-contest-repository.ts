/**
 * Prisma adapter for ContestRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { ContestRepository } from '@poolmaster/shared/db';
import type { Contest } from '@poolmaster/shared/domain';

export class PrismaContestRepository implements ContestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Contest | null> {
    const row = await this.prisma.contest.findFirst({
      where: { id },
      include: {
        sportEvent: { select: { sport: true } },
      },
    });
    return row ? mapToContest(row) : null;
  }

  async findByLeague(leagueId: string): Promise<Contest[]> {
    const rows = await this.prisma.contest.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      include: {
        sportEvent: { select: { sport: true } },
      },
    });
    return rows.map(mapToContest);
  }

  async create(contest: Omit<Contest, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contest> {
    const row = await this.prisma.contest.create({
      data: {
        leagueId: contest.leagueId,
        sportEventId: contest.sportEventId || undefined,
        name: contest.name,
        status: contest.status,
        contestType: contest.contestType,
        selectionType: contest.selectionType,
        scoringEngine: contest.scoringEngine,
        isExclusive: contest.isExclusive,
        scoringStopsOnElimination: contest.scoringStopsOnElimination,
        startsAt: contest.startsAt,
        endsAt: contest.endsAt,
        lockAt: contest.lockAt,
      },
    });
    return mapToContest(row);
  }

  async update(id: string, updates: Partial<Contest>): Promise<Contest> {
    const row = await this.prisma.contest.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.sportEventId !== undefined && { sportEventId: updates.sportEventId }),
        ...(updates.startsAt !== undefined && { startsAt: updates.startsAt }),
        ...(updates.endsAt !== undefined && { endsAt: updates.endsAt }),
        ...(updates.lockAt !== undefined && { lockAt: updates.lockAt }),
        ...(updates.isExclusive !== undefined && { isExclusive: updates.isExclusive }),
      },
    });
    return mapToContest(row);
  }

  async delete(id: string): Promise<void> {
    // Delete child records in dependency order before removing the contest
    await this.prisma.$transaction([
      this.prisma.rosterPick.deleteMany({ where: { entry: { contestId: id } } }),
      this.prisma.draftPickHistory.deleteMany({ where: { session: { contestId: id } } }),
      this.prisma.draftSession.deleteMany({ where: { contestId: id } }),
      this.prisma.contestEntry.deleteMany({ where: { contestId: id } }),
      this.prisma.contestConfiguration.deleteMany({ where: { contestId: id } }),
      this.prisma.contest.delete({ where: { id } }),
    ]);
  }
}

function mapToContest(row: {
  id: string;
  leagueId: string;
  sportEventId: string | null;
  name: string;
  status: string;
  contestType: string;
  selectionType: string;
  scoringEngine: string;
  sportEvent?: { sport: string } | null;
  isExclusive: boolean;
  scoringStopsOnElimination: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  lockAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Contest {
  return {
    id: row.id,
    leagueId: row.leagueId,
    sportEventId: row.sportEventId ?? undefined,
    name: row.name,
    status: row.status as Contest['status'],
    contestType: row.contestType as Contest['contestType'],
    selectionType: row.selectionType as Contest['selectionType'],
    scoringEngine: row.scoringEngine as Contest['scoringEngine'],
    sport: row.sportEvent?.sport as Contest['sport'],
    isExclusive: row.isExclusive,
    scoringStopsOnElimination: row.scoringStopsOnElimination,
    startsAt: row.startsAt ?? undefined,
    endsAt: row.endsAt ?? undefined,
    lockAt: row.lockAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
