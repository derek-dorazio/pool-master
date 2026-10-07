/**
 * Prisma adapter for the one ContestRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  ContestCreate,
  ContestRepository,
  ContestStatusFilter,
  ContestStatusTransition,
} from '@poolmaster/shared/db';
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

  async findBySportEvent(
    sportEventId: string,
    filter?: ContestStatusFilter,
  ): Promise<Contest[]> {
    const rows = await this.prisma.contest.findMany({
      where: {
        sportEventId,
        ...((filter?.statuses || filter?.excludeStatuses?.length) && {
          status: {
            ...(filter.statuses && { in: [...filter.statuses] }),
            ...(filter.excludeStatuses?.length && { notIn: [...filter.excludeStatuses] }),
          },
        }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        sportEvent: { select: { sport: true } },
      },
    });
    return rows.map(mapToContest);
  }

  async create(contest: ContestCreate): Promise<Contest> {
    const row = await this.prisma.contest.create({
      data: {
        leagueId: contest.leagueId,
        sportEventId: contest.sportEventId,
        name: contest.name,
        status: contest.status,
        contestFormat: contest.contestFormat,
        selectionType: contest.selectionType,
        scoringEngine: contest.scoringEngine,
      },
      include: {
        sportEvent: { select: { sport: true } },
      },
    });
    return mapToContest(row);
  }

  async transitionStatus(id: string, transition: ContestStatusTransition): Promise<boolean> {
    const result = await this.prisma.contest.updateMany({
      where: { id, status: { in: [...transition.from] } },
      data: {
        status: transition.to,
        ...(transition.startsAt && { startsAt: transition.startsAt }),
        ...(transition.endsAt && { endsAt: transition.endsAt }),
      },
    });
    return result.count > 0;
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
        ...(updates.isExclusive !== undefined && { isExclusive: updates.isExclusive }),
      },
    });
    return mapToContest(row);
  }

  async delete(id: string): Promise<void> {
    // Delete child records in dependency order before removing the contest
    // The configuration's scoring rules and prize definitions reference it without a cascade,
    // so they go first. Before #247 they were not deleted at all: harmless while no DRAFT contest
    // had a rule, a foreign-key failure once #246 gave every golf configuration one. Entry
    // standings cascade from the contest.
    await this.prisma.$transaction([
      this.prisma.contestEntryPick.deleteMany({ where: { entry: { contestId: id } } }),
      this.prisma.draftPickHistory.deleteMany({ where: { session: { contestId: id } } }),
      this.prisma.draftSession.deleteMany({ where: { contestId: id } }),
      this.prisma.contestEntry.deleteMany({ where: { contestId: id } }),
      this.prisma.participantContestScoringRule.deleteMany({ where: { contestConfiguration: { contestId: id } } }),
      this.prisma.contestPrizeDefinition.deleteMany({ where: { contestConfiguration: { contestId: id } } }),
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
  contestFormat: string;
  selectionType: string;
  scoringEngine: string;
  sportEvent?: { sport: string } | null;
  isExclusive: boolean;
  scoringStopsOnElimination: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Contest {
  return {
    id: row.id,
    leagueId: row.leagueId,
    sportEventId: row.sportEventId ?? undefined,
    name: row.name,
    status: row.status as Contest['status'],
    contestFormat: row.contestFormat as Contest['contestFormat'],
    selectionType: row.selectionType as Contest['selectionType'],
    scoringEngine: row.scoringEngine as Contest['scoringEngine'],
    sport: row.sportEvent?.sport as Contest['sport'],
    isExclusive: row.isExclusive,
    scoringStopsOnElimination: row.scoringStopsOnElimination,
    startsAt: row.startsAt ?? undefined,
    endsAt: row.endsAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
