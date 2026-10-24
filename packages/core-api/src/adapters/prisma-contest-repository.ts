/**
 * Prisma adapter for the one ContestRepository port.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  ContestCreate,
  ContestCreateResult,
  ContestRepository,
  ContestSeasonFull,
  ContestSeasonLimits,
  ContestSeasonMoveResult,
  ContestStatusFilter,
  ContestStatusTransition,
  ContestUpdate,
} from '@poolmaster/shared/db';
import type { Contest, ContestFormat, ContestStatus, CupWeight, SelectionType, Sport } from '@poolmaster/shared/domain';
import { lockContestRow } from './contest-row-lock';

/**
 * What every contest read joins: its events in sequence order with their sport (#713), its draw
 * when it has one (#601), and a squares contest's game and digits draw (#711).
 */
const CONTEST_INCLUDE = {
  sportEvents: {
    select: { sportEventId: true, sportEvent: { select: { sport: true } } },
    orderBy: { sequence: 'asc' },
  },
  draw: { select: { drawnAt: true } },
  squaresGame: { select: { sportEventMatchId: true } },
  squaresDraw: { select: { drawnAt: true } },
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

  async findSportLeagueIdsBySeason(leagueId: string, seasonYear: number): Promise<string[]> {
    return sportLeagueIdsBySeason(this.prisma, leagueId, seasonYear);
  }

  async create(contest: ContestCreate, limits: ContestSeasonLimits): Promise<ContestCreateResult> {
    return this.prisma.$transaction(async (tx) => {
      const full = await seasonWithoutRoom(tx, contest.leagueId, contest.seasonYear, limits);
      if (full) return full;
      const row = await tx.contest.create({
        data: {
          leagueId: contest.leagueId,
          name: contest.name,
          status: contest.status,
          contestFormat: contest.contestFormat,
          selectionType: contest.selectionType,
          seasonYear: contest.seasonYear,
          sportEvents: {
            create: contest.sportEventIds.map((sportEventId, index) => ({ sportEventId, sequence: index + 1 })),
          },
          ...(contest.squaresGameMatchId !== undefined && {
            squaresGame: { create: { sportEventMatchId: contest.squaresGameMatchId } },
          }),
        },
        include: CONTEST_INCLUDE,
      });
      return { status: 'created', contest: mapToContest(row) };
    });
  }

  async moveToSeason(id: string, seasonYear: number, limits: ContestSeasonLimits): Promise<ContestSeasonMoveResult> {
    return this.prisma.$transaction(async (tx) => {
      const { leagueId } = await tx.contest.findUniqueOrThrow({ where: { id }, select: { leagueId: true } });
      const full = await seasonWithoutRoom(tx, leagueId, seasonYear, limits);
      if (full) return full;
      await tx.contest.update({ where: { id }, data: { seasonYear } });
      return { status: 'moved' };
    });
  }

  async findBySportEvent(
    sportEventId: string,
    filter?: ContestStatusFilter,
  ): Promise<Contest[]> {
    const rows = await this.prisma.contest.findMany({
      where: {
        sportEvents: { some: { sportEventId } },
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

  async findByStatuses(statuses: readonly Contest['status'][]): Promise<Contest[]> {
    const rows = await this.prisma.contest.findMany({
      where: { status: { in: [...statuses] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: CONTEST_INCLUDE,
    });
    return rows.map(mapToContest);
  }

  async transitionStatus(id: string, transition: ContestStatusTransition): Promise<boolean> {
    const result = await this.prisma.contest.updateMany({
      where: { id, status: { in: [...transition.from] } },
      data: {
        status: transition.to,
        ...(transition.openedAt && { openedAt: transition.openedAt }),
        ...(transition.startsAt && { startsAt: transition.startsAt }),
        ...(transition.endsAt && { endsAt: transition.endsAt }),
      },
    });
    return result.count > 0;
  }

  async setCupWeight(id: string, cupWeight: Contest['cupWeight'], whileIn: readonly Contest['status'][]): Promise<boolean> {
    const result = await this.prisma.contest.updateMany({
      where: { id, status: { in: [...whileIn] } },
      data: { cupWeight },
    });
    return result.count > 0;
  }

  async update(id: string, updates: ContestUpdate): Promise<Contest> {
    const row = await this.prisma.contest.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.startsAt !== undefined && { startsAt: updates.startsAt }),
        ...(updates.endsAt !== undefined && { endsAt: updates.endsAt }),
      },
      include: CONTEST_INCLUDE,
    });
    return mapToContest(row);
  }

  async replaceSportEvents(id: string, sportEventIds: readonly string[]): Promise<void> {
    // The contest row lock comes first, as every entry write and the draw take it (#644), so an
    // entry created meanwhile is either seen here or created after with the new events.
    await this.prisma.$transaction(async (tx) => {
      await lockContestRow(tx, id);
      const current = await tx.contestSportEvent.findMany({ where: { contestId: id }, select: { sportEventId: true } });
      const removed = current.map((row) => row.sportEventId).filter((eventId) => !sportEventIds.includes(eventId));
      if (removed.length > 0) {
        await tx.contestEntryPick.deleteMany({
          where: { entry: { contestId: id }, sportEventParticipant: { sportEventId: { in: removed } } },
        });
        await tx.contestEntryMatchPrediction.deleteMany({
          where: { contestEntry: { contestId: id }, sportEventMatch: { sportEventId: { in: removed } } },
        });
        await tx.contestEntryEvent.deleteMany({
          where: { contestEntry: { contestId: id }, sportEventId: { in: removed } },
        });
      }
      // Sequences are rewritten whole: renumbering in place would collide on (contest, sequence).
      await tx.contestSportEvent.deleteMany({ where: { contestId: id } });
      await tx.contestSportEvent.createMany({
        data: sportEventIds.map((sportEventId, index) => ({ contestId: id, sportEventId, sequence: index + 1 })),
      });
      const entries = await tx.contestEntry.findMany({ where: { contestId: id }, select: { id: true } });
      await tx.contestEntryEvent.createMany({
        data: entries.flatMap((entry) => sportEventIds.map((sportEventId) => ({ contestEntryId: entry.id, sportEventId }))),
        skipDuplicates: true,
      });
    });
  }

  async delete(id: string): Promise<void> {
    // Delete child records in dependency order before removing the contest
    // The configuration's scoring rules and prize definitions reference it without a cascade,
    // so they go first. Before #247 they were not deleted at all: harmless while no DRAFT contest
    // had a rule, a foreign-key failure once #246 gave every golf configuration one. Entry
    // standings cascade from the contest.
    // The contest row lock comes first, the order a random draw takes it in (#646).
    await this.prisma.$transaction(async (tx) => {
      await lockContestRow(tx, id);
      await tx.contestEntryPick.deleteMany({ where: { entry: { contestId: id } } });
      await tx.contestEntry.deleteMany({ where: { contestId: id } });
      await tx.participantContestScoringRule.deleteMany({ where: { contestConfiguration: { contestId: id } } });
      await tx.contestPrizeDefinition.deleteMany({ where: { contestConfiguration: { contestId: id } } });
      await tx.contestConfiguration.deleteMany({ where: { contestId: id } });
      await tx.contest.delete({ where: { id } });
    });
  }
}

function mapToContest(row: {
  id: string;
  leagueId: string;
  sportEvents: { sportEventId: string; sportEvent: { sport: Sport } }[];
  name: string;
  status: ContestStatus;
  contestFormat: ContestFormat;
  selectionType: SelectionType;
  draw?: { drawnAt: Date } | null;
  squaresGame?: { sportEventMatchId: string } | null;
  squaresDraw?: { drawnAt: Date } | null;
  openedAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  seasonYear: number;
  cupWeight: CupWeight;
  createdAt: Date;
  updatedAt: Date;
}): Contest {
  return {
    id: row.id,
    leagueId: row.leagueId,
    sportEventIds: row.sportEvents.map((event) => event.sportEventId),
    name: row.name,
    status: row.status,
    contestFormat: row.contestFormat,
    selectionType: row.selectionType,
    // Every event of a contest shares its sport (#713), so the first one answers for all.
    sport: row.sportEvents.at(0)?.sportEvent.sport,
    openedAt: row.openedAt ?? undefined,
    startsAt: row.startsAt ?? undefined,
    endsAt: row.endsAt ?? undefined,
    // A contest has at most one of the two draws: a random draw's deal or squares' digits.
    drawnAt: row.draw?.drawnAt ?? row.squaresDraw?.drawnAt ?? undefined,
    squaresGameMatchId: row.squaresGame?.sportEventMatchId ?? undefined,
    seasonYear: row.seasonYear,
    cupWeight: row.cupWeight,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The different sports leagues of the league's contests in one season (#947), drafts included. */
async function sportLeagueIdsBySeason(
  db: PrismaClient | Prisma.TransactionClient,
  leagueId: string,
  seasonYear: number,
): Promise<string[]> {
  const rows = await db.eventSeries.findMany({
    where: {
      sportEvents: {
        some: {
          contests: {
            some: { contest: { leagueId, seasonYear } },
          },
        },
      },
    },
    select: { sportLeagueId: true },
    distinct: ['sportLeagueId'],
  });
  return rows.map((row) => row.sportLeagueId);
}

/**
 * Null when the season has room for a contest in `limits.sportLeagueId`, else the cap and how
 * many sports leagues it already uses. Takes the league's row lock first, so contests made or moved into the
 * season meanwhile are counted, and two racing for its last sports league cannot both get it.
 */
async function seasonWithoutRoom(
  tx: Prisma.TransactionClient,
  leagueId: string,
  seasonYear: number,
  limits: ContestSeasonLimits,
): Promise<ContestSeasonFull | null> {
  if (limits.sportLeaguesPerYear === null) return null;
  await tx.$queryRaw`SELECT id FROM "leagues" WHERE id = ${leagueId}::uuid FOR UPDATE`;
  const used = await sportLeagueIdsBySeason(tx, leagueId, seasonYear);
  return used.includes(limits.sportLeagueId) || used.length < limits.sportLeaguesPerYear
    ? null
    : { status: 'sportsLeagueLimitReached', sportLeaguesPerYear: limits.sportLeaguesPerYear, sportLeagueCount: used.length };
}
