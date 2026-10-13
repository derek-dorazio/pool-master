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
import type { Contest, ContestFormat, ContestStatus, SelectionType, Sport } from '@poolmaster/shared/domain';

/** What every contest read joins: its event's sport, and its draw when it has one (#601). */
const CONTEST_INCLUDE = {
  sportEvent: { select: { sport: true } },
  draw: { select: { drawnAt: true } },
} as const;

export class PrismaContestRepository implements ContestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Contest | null> {
    const row = await this.prisma.contest.findFirst({
      where: { id },
      include: CONTEST_INCLUDE,
    });
    return row ? mapToContest(row) : null;
  }

  async findByLeague(leagueId: string): Promise<Contest[]> {
    const rows = await this.prisma.contest.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      include: CONTEST_INCLUDE,
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
      include: CONTEST_INCLUDE,
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
      },
      include: CONTEST_INCLUDE,
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
      },
      include: CONTEST_INCLUDE,
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
  status: ContestStatus;
  contestFormat: ContestFormat;
  selectionType: SelectionType;
  sportEvent?: { sport: Sport } | null;
  draw?: { drawnAt: Date } | null;
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
    status: row.status,
    contestFormat: row.contestFormat,
    selectionType: row.selectionType,
    sport: row.sportEvent?.sport,
    scoringStopsOnElimination: row.scoringStopsOnElimination,
    startsAt: row.startsAt ?? undefined,
    endsAt: row.endsAt ?? undefined,
    drawnAt: row.draw?.drawnAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
