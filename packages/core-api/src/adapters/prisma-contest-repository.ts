/**
 * Prisma adapter for ContestRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { ContestRepository } from '@poolmaster/shared/db';
import type { Contest } from '@poolmaster/shared/domain';

export class PrismaContestRepository implements ContestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string, tenantId: string): Promise<Contest | null> {
    const row = await this.prisma.contest.findFirst({
      where: { id, league: { tenantId } },
    });
    return row ? mapToContest(row) : null;
  }

  async findByLeague(leagueId: string): Promise<Contest[]> {
    const rows = await this.prisma.contest.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapToContest);
  }

  async create(contest: Omit<Contest, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contest> {
    const row = await this.prisma.contest.create({
      data: {
        leagueId: contest.leagueId,
        seasonId: contest.seasonId || undefined,
        sportEventId: contest.sportEventId || undefined,
        name: contest.name,
        status: contest.status,
        contestType: contest.contestType,
        selectionType: contest.selectionType,
        scoringEngine: contest.scoringEngine,
        sport: contest.sport,
        isExclusive: contest.isExclusive,
        scoringStopsOnElimination: contest.scoringStopsOnElimination,
        scoringRules: contest.scoringRules as object,
        payoutConfig: (contest as Contest & { payoutConfig?: object }).payoutConfig ?? {},
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
        ...(updates.sport !== undefined && { sport: updates.sport }),
        ...(updates.scoringRules !== undefined && { scoringRules: updates.scoringRules as object }),
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
  seasonId: string | null;
  sportEventId: string | null;
  name: string;
  status: string;
  contestType: string;
  selectionType: string;
  scoringEngine: string;
  sport: string | null;
  isExclusive: boolean;
  scoringStopsOnElimination: boolean;
  scoringRules: unknown;
  payoutConfig: unknown;
  startsAt: Date | null;
  endsAt: Date | null;
  lockAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Contest {
  return {
    id: row.id,
    leagueId: row.leagueId,
    seasonId: row.seasonId ?? '',
    sportEventId: row.sportEventId ?? undefined,
    name: row.name,
    status: row.status as Contest['status'],
    contestType: row.contestType as Contest['contestType'],
    selectionType: row.selectionType as Contest['selectionType'],
    scoringEngine: row.scoringEngine as Contest['scoringEngine'],
    sport: row.sport as Contest['sport'],
    isExclusive: row.isExclusive,
    scoringStopsOnElimination: row.scoringStopsOnElimination,
    scoringRules: (row.scoringRules ?? {}) as Contest['scoringRules'],
    startsAt: row.startsAt ?? undefined,
    endsAt: row.endsAt ?? undefined,
    lockAt: row.lockAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
