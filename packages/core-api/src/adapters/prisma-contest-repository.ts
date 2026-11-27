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
  ContestStatusFilter,
  ContestStatusTransition,
  ContestUpdate,
  DeletedDraftContest,
  PendingDrawReceipts,
  ReminderCheck,
} from '@poolmaster/shared/db';
import { championshipYear, ContestStatus, SelectionType, SportEventStatus, type Contest, type ContestFormat, type CupWeight, FINISHED_SPORT_EVENT_STATUSES } from '@poolmaster/shared/domain';
import { forgettingReads, memoizedRead, memoizedReadMany, ReadMemoKey } from '../core/request-read-memo';
import { lockContestRow, lockContestRowsAtOnce } from './contest-row-lock';
import { insertBackgroundJobs } from './prisma-background-job-repository';
import { SPORT_LEAGUE_SPORT_SELECT, type SportLeagueSportRow } from './sport-of';

/**
 * The order a contest's covered slots are read in: by their event's start, then the slot's own
 * start, so a contest's events come in the order they are played.
 */
export const COVERED_SLOT_ORDER: Prisma.ContestSeasonSlotOrderByWithRelationInput[] = [
  { seasonSlot: { eventSlot: { sportEvent: { startDate: 'asc' } } } },
  { seasonSlot: { startsAt: { sort: 'asc', nulls: 'last' } } },
  { sportLeagueSeasonCompetitionSlotId: 'asc' },
];

/** A contest that covers some slot of the event: the where that replaced "is linked to the event" (#2014). */
export function coversEventWhere(sportEventId: string | { in: string[] }): Prisma.ContestWhereInput {
  return { seasonSlots: { some: { seasonSlot: { eventSlot: { sportEventId } } } } };
}

/**
 * What every contest read joins: its Season with its sport (#2014), its covered slots in play order
 * with each slot's definition and event, its draw when it has one (#601), and a squares contest's
 * game and digits draw (#711).
 */
const CONTEST_INCLUDE = {
  sportLeagueSeason: { select: { championshipYear: true, sportLeague: { select: SPORT_LEAGUE_SPORT_SELECT } } },
  seasonSlots: {
    select: {
      sportLeagueSeasonCompetitionSlotId: true,
      seasonSlot: { select: { sportLeagueCompetitionSlotId: true, eventSlot: { select: { sportEventId: true } } } },
    },
    orderBy: COVERED_SLOT_ORDER,
  },
  draw: { select: { drawnAt: true } },
  squaresGame: { select: { sportEventRoundMatchId: true } },
  squaresDraw: { select: { drawnAt: true } },
} as const;

export class PrismaContestRepository implements ContestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Contest | null> {
    return memoizedRead(this.prisma, `${ReadMemoKey.contest}${id}`, async () => {
      const row = await this.prisma.contest.findFirst({
        where: { id },
        include: CONTEST_INCLUDE,
      });
      return row ? mapToContest(row) : null;
    });
  }

  async findByIds(ids: readonly string[]): Promise<Contest[]> {
    if (ids.length === 0) return [];
    return memoizedReadMany(this.prisma, ReadMemoKey.contest, ids, async (missing) => {
      const rows = await this.prisma.contest.findMany({ where: { id: { in: [...missing] } }, include: CONTEST_INCLUDE });
      return rows.map(mapToContest);
    });
  }

  async findByLeague(leagueId: string, statuses: readonly Contest['status'][]): Promise<Contest[]> {
    const rows = await this.prisma.contest.findMany({
      where: { leagueId, status: { in: [...statuses] } },
      orderBy: { createdAt: 'desc' },
      include: CONTEST_INCLUDE,
    });
    return rows.map(mapToContest);
  }

  async findCurrentByLeague(leagueId: string, now: Date): Promise<Contest[]> {
    const rows = await this.prisma.contest.findMany({
      where: {
        leagueId,
        status: { in: [ContestStatus.DRAFT, ContestStatus.OPEN, ContestStatus.ACTIVE] },
        // A draft that can never open is left out (#1161, #1217): one with an event finished or
        // cancelled, which is past every cutoff, and one closing at its event's start once an
        // event has started, since a started event cannot be removed. Only a squares contest with
        // its game closes later, as `contestCutoff` says.
        NOT: {
          status: ContestStatus.DRAFT,
          OR: [
            { seasonSlots: { some: { seasonSlot: { eventSlot: { sportEvent: { status: { in: [...FINISHED_SPORT_EVENT_STATUSES] } } } } } } },
            {
              // Started as `hasSportEventStarted` has it: by its start date, or under way early.
              seasonSlots: { some: { seasonSlot: { eventSlot: { sportEvent: { OR: [{ startDate: { lte: now } }, { status: SportEventStatus.IN_PROGRESS }] } } } } },
              NOT: { selectionType: SelectionType.SQUARES, squaresGame: { isNot: null } },
            },
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      include: CONTEST_INCLUDE,
    });
    return rows.map(mapToContest);
  }

  async findFinishedByLeague(leagueId: string, endedFrom: Date, endedBefore: Date): Promise<Contest[]> {
    const rows = await this.prisma.contest.findMany({
      where: { leagueId, status: ContestStatus.COMPLETED, endsAt: { gte: endedFrom, lt: endedBefore } },
      orderBy: [{ endsAt: 'desc' }, { id: 'asc' }],
      include: CONTEST_INCLUDE,
    });
    return rows.map(mapToContest);
  }

  async findFinishedYearsByLeague(leagueId: string): Promise<number[]> {
    const rows = await this.prisma.contest.findMany({
      where: { leagueId, status: ContestStatus.COMPLETED, endsAt: { not: null } },
      select: { endsAt: true },
    });
    const years = new Set(rows.flatMap(({ endsAt }) => (endsAt ? [championshipYear(endsAt)] : [])));
    return [...years].sort((left, right) => right - left);
  }

  async findOpenByLeague(leagueId: string): Promise<Array<Pick<Contest, 'id' | 'name'>>> {
    return this.prisma.contest.findMany({
      where: { leagueId, status: ContestStatus.OPEN },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
  }

  async findSportLeagueIdsBySeason(leagueId: string, seasonYear: number): Promise<string[]> {
    return sportLeagueIdsBySeason(this.prisma, leagueId, seasonYear);
  }

  async create(contest: ContestCreate, limits: ContestSeasonLimits): Promise<ContestCreateResult> {
    return this.prisma.$transaction(async (tx) => {
      const full = await seasonWithoutRoom(tx, contest.leagueId, contest.seasonYear, limits);
      if (full) return full;
      const { id } = await tx.contest.create({
        data: {
          leagueId: contest.leagueId,
          name: contest.name,
          status: contest.status,
          contestFormat: contest.contestFormat,
          selectionType: contest.selectionType,
          sportLeagueSeasonId: contest.sportLeagueSeasonId,
          ...(contest.squaresGameMatchId !== undefined && {
            squaresGame: { create: { sportEventRoundMatchId: contest.squaresGameMatchId } },
          }),
        },
        select: { id: true },
      });
      // The covered slots are written once, here (#2014): no later write adds one.
      await tx.contestSeasonSlot.createMany({
        data: contest.seasonSlotIds.map((sportLeagueSeasonCompetitionSlotId) => ({
          contestId: id,
          sportLeagueSeasonId: contest.sportLeagueSeasonId,
          sportLeagueSeasonCompetitionSlotId,
        })),
      });
      const row = await tx.contest.findUniqueOrThrow({ where: { id }, include: CONTEST_INCLUDE });
      return { status: 'created', contest: mapToContest(row) };
    });
  }

  async findBySportEvent(
    sportEventId: string,
    filter?: ContestStatusFilter,
  ): Promise<Contest[]> {
    const rows = await this.prisma.contest.findMany({
      where: {
        ...coversEventWhere(sportEventId),
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

  async findBySportEvents(sportEventIds: readonly string[]): Promise<Contest[]> {
    if (sportEventIds.length === 0) return [];
    const rows = await this.prisma.contest.findMany({
      where: coversEventWhere({ in: [...new Set(sportEventIds)] }),
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

  async findDraftsStartingBy({ firstStartsBy, createdBy, firstStatuses }: {
    firstStartsBy: Date;
    createdBy: Date;
    firstStatuses: readonly SportEventStatus[];
  }): Promise<Contest[]> {
    const rows = await this.prisma.contest.findMany({
      where: {
        status: ContestStatus.DRAFT,
        createdAt: { lte: createdBy },
        // A covered event starts by then and is still upcoming, and none starting by then has
        // moved on: so the first event is upcoming. The sweep reads which event that is.
        seasonSlots: {
          some: { seasonSlot: { eventSlot: { sportEvent: { startDate: { lte: firstStartsBy }, status: { in: [...firstStatuses] } } } } },
          none: { seasonSlot: { eventSlot: { sportEvent: { startDate: { lte: firstStartsBy }, status: { notIn: [...firstStatuses] } } } } },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: CONTEST_INCLUDE,
    });
    return rows.map(mapToContest);
  }

  async findReminderChecksDue(now: Date): Promise<Contest[]> {
    const rows = await this.prisma.contest.findMany({
      where: { nextReminderAt: { lte: now } },
      orderBy: [{ nextReminderAt: 'asc' }, { id: 'asc' }],
      include: CONTEST_INCLUDE,
    });
    return rows.map(mapToContest);
  }

  async scheduleReminderChecks(schedule: readonly ReminderCheck[], sweptAt: Date): Promise<void> {
    // Prisma has no update of many rows to different values, so the contests are written in one
    // statement per distinct time, in one transaction. A sweep's contests share few times: those
    // on one event come due together and move on to its next reminder together.
    const byTime = new Map<number | null, string[]>();
    for (const { contestId, at } of schedule) {
      const key = at === null ? null : at.getTime();
      byTime.set(key, [...(byTime.get(key) ?? []), contestId]);
    }
    if (byTime.size === 0) return;
    await this.prisma.$transaction([...byTime].map(([time, contestIds]) =>
      // poolmaster-allow-query-in-loop: one statement per distinct reminder time, which Prisma cannot set in one
      this.prisma.contest.updateMany({
        // A check moved past the sweep's time was rechecked while it ran, so it is kept.
        where: { id: { in: contestIds }, nextReminderAt: { lte: sweptAt } },
        data: { nextReminderAt: time === null ? null : new Date(time) },
      })));
  }

  async recheckReminders(scope: { contestIds: readonly string[] } | { sportEventId: string }, at: Date): Promise<void> {
    if ('contestIds' in scope && scope.contestIds.length === 0) return;
    await this.prisma.contest.updateMany({
      where: {
        status: { in: [ContestStatus.OPEN, ContestStatus.ACTIVE] },
        ...('contestIds' in scope
          ? { id: { in: [...scope.contestIds] } }
          : coversEventWhere(scope.sportEventId)),
      },
      data: { nextReminderAt: at },
    });
  }

  async findDrawReceiptsPending(): Promise<PendingDrawReceipts[]> {
    const rows = await this.prisma.contestDraw.findMany({
      where: { receiptsPendingContestSeasonSlotId: { not: null } },
      orderBy: [{ drawnAt: 'asc' }, { contestId: 'asc' }],
      select: {
        contestId: true,
        receiptsPendingContestSeasonSlot: { select: { seasonSlot: { select: { eventSlot: { select: { sportEventId: true } } } } } },
      },
    });
    // The dealt slot's event: a covered slot keeps its event, so only a slot since re-homed has none.
    return rows.flatMap((row) => {
      const sportEventId = row.receiptsPendingContestSeasonSlot?.seasonSlot.eventSlot?.sportEventId;
      return sportEventId === undefined ? [] : [{ contestId: row.contestId, sportEventId }];
    });
  }

  async clearDrawReceiptsPending(contestIds: readonly string[]): Promise<void> {
    if (contestIds.length === 0) return;
    await this.prisma.contestDraw.updateMany({
      where: { contestId: { in: [...contestIds] }, receiptsPendingContestSeasonSlotId: { not: null } },
      data: { receiptsPendingContestSeasonSlotId: null },
    });
  }

  async transitionStatus(id: string, transition: ContestStatusTransition): Promise<boolean> {
    return (await this.transitionStatuses([id], transition)).length > 0;
  }

  /**
   * One guarded write. With `jobs`, the jobs for the contests it moved are written in the same
   * transaction, so a move that rolls back queues nothing and a committed one never loses its job.
   */
  async transitionStatuses(ids: readonly string[], transition: ContestStatusTransition): Promise<string[]> {
    if (ids.length === 0) return [];
    const { jobs } = transition;
    const move = async (db: PrismaClient | Prisma.TransactionClient): Promise<string[]> => {
      const moved = (await db.contest.updateManyAndReturn({
        where: { id: { in: [...ids] }, status: { in: [...transition.from] } },
        data: toStatusTransitionData(transition),
        select: { id: true },
      })).map((row) => row.id);
      if (jobs && moved.length > 0) await insertBackgroundJobs(db, jobs(moved));
      return moved;
    };
    return forgettingReads(ReadMemoKey.contest, () => (jobs ? this.prisma.$transaction(move) : move(this.prisma)));
  }

  async setCupWeight(id: string, cupWeight: Contest['cupWeight'], whileIn: readonly Contest['status'][]): Promise<boolean> {
    const result = await forgettingReads(ReadMemoKey.contest, () => this.prisma.contest.updateMany({
      where: { id, status: { in: [...whileIn] } },
      data: { cupWeight },
    }));
    return result.count > 0;
  }

  async update(id: string, updates: ContestUpdate): Promise<Contest> {
    const row = await forgettingReads(ReadMemoKey.contest, () => this.prisma.contest.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.startsAt !== undefined && { startsAt: updates.startsAt }),
        ...(updates.endsAt !== undefined && { endsAt: updates.endsAt }),
      },
      include: CONTEST_INCLUDE,
    }));
    return mapToContest(row);
  }

  async replaceCoveredSlots(id: string, seasonSlotIds: readonly string[]): Promise<void> {
    // The contest row lock comes first, as every entry write and the draw take it (#644), so an
    // entry created meanwhile is either seen here or created after with the new events.
    return forgettingReads(ReadMemoKey.contest, () => this.prisma.$transaction(async (tx) => {
      await lockContestRow(tx, id);
      const contest = await tx.contest.findUniqueOrThrow({ where: { id }, select: { sportLeagueSeasonId: true } });
      const current = await tx.contestSeasonSlot.findMany({
        where: { contestId: id },
        select: { seasonSlot: { select: { eventSlot: { select: { sportEventId: true } } } } },
      });
      const next = seasonSlotIds.length === 0 ? [] : await tx.sportEventSlot.findMany({
        where: { sportLeagueSeasonId: contest.sportLeagueSeasonId, sportLeagueSeasonCompetitionSlotId: { in: [...seasonSlotIds] } },
        select: { sportEventId: true },
      });
      const sportEventIds = [...new Set(next.map((slot) => slot.sportEventId))];
      const removed = [...new Set(current.flatMap((row) => (row.seasonSlot.eventSlot ? [row.seasonSlot.eventSlot.sportEventId] : [])))]
        .filter((eventId) => !sportEventIds.includes(eventId));
      if (removed.length > 0) {
        await tx.contestEntryPick.deleteMany({
          where: { entry: { contestId: id }, sportEventParticipant: { sportEventId: { in: removed } } },
        });
        await tx.contestEntryMatchPrediction.deleteMany({
          where: { contestEntry: { contestId: id }, sportEventRoundMatch: { sportEventId: { in: removed } } },
        });
        await tx.contestEntryEvent.deleteMany({
          where: { contestEntry: { contestId: id }, sportEventId: { in: removed } },
        });
      }
      // The covered slots are resolved again whole, as at creation (#2014).
      await tx.contestSeasonSlot.deleteMany({ where: { contestId: id } });
      await tx.contestSeasonSlot.createMany({
        data: seasonSlotIds.map((sportLeagueSeasonCompetitionSlotId) => ({
          contestId: id,
          sportLeagueSeasonId: contest.sportLeagueSeasonId,
          sportLeagueSeasonCompetitionSlotId,
        })),
      });
      const entries = await tx.contestEntry.findMany({ where: { contestId: id }, select: { id: true } });
      await tx.contestEntryEvent.createMany({
        data: entries.flatMap((entry) => sportEventIds.map((sportEventId) => ({ contestEntryId: entry.id, sportEventId }))),
        skipDuplicates: true,
      });
    }));
  }

  async delete(id: string): Promise<void> {
    // Delete child records in dependency order before removing the contest
    // The configuration's scoring rules and prize definitions reference it without a cascade,
    // so they go first. Before #247 they were not deleted at all: harmless while no DRAFT contest
    // had a rule, a foreign-key failure once #246 gave every golf configuration one. Entry
    // standings cascade from the contest.
    // The contest row lock comes first, the order a random draw takes it in (#646).
    await forgettingReads([ReadMemoKey.contestConfiguration, ReadMemoKey.contest], () => this.prisma.$transaction(async (tx) => {
      await lockContestRow(tx, id);
      await tx.contestEntryPick.deleteMany({ where: { entry: { contestId: id } } });
      await tx.contestEntry.deleteMany({ where: { contestId: id } });
      await tx.participantContestScoringRule.deleteMany({ where: { contestConfiguration: { contestId: id } } });
      await tx.contestConfiguration.deleteMany({ where: { contestId: id } });
      await tx.contest.delete({ where: { id } });
    }));
  }

  async deleteAbandonedDraftsBatch(lastEventStartedBefore: Date, limit: number): Promise<DeletedDraftContest[]> {
    const where = abandonedDraftWhere(lastEventStartedBefore);
    const candidates = await this.prisma.contest.findMany({ where, select: { id: true }, orderBy: { id: 'asc' }, take: limit });
    if (candidates.length === 0) return [];
    return this.prisma.$transaction(async (tx) => {
      // The candidates were chosen before the locks. A commissioner may have opened one or given
      // it a later event meanwhile, so the batch is read again under them.
      await lockContestRowsAtOnce(tx, candidates.map((contest) => contest.id));
      const drafts = await tx.contest.findMany({
        where: { id: { in: candidates.map((contest) => contest.id) }, ...where },
        select: { id: true, leagueId: true },
        orderBy: { id: 'asc' },
      });
      if (drafts.length === 0) return drafts;
      // The same child-first order `delete` takes, for every draft of the batch at once.
      const contestId = { in: drafts.map((draft) => draft.id) };
      await tx.contestEntryPick.deleteMany({ where: { entry: { contestId } } });
      await tx.contestEntry.deleteMany({ where: { contestId } });
      await tx.participantContestScoringRule.deleteMany({ where: { contestConfiguration: { contestId } } });
      await tx.contestConfiguration.deleteMany({ where: { contestId } });
      await tx.contest.deleteMany({ where: { id: contestId } });
      return drafts;
    });
  }
}

/** A DRAFT contest with at least one event, every one of which started before the cutoff (#1195). */
function abandonedDraftWhere(lastEventStartedBefore: Date): Prisma.ContestWhereInput {
  return {
    status: ContestStatus.DRAFT,
    seasonSlots: {
      some: { seasonSlot: { eventSlot: { isNot: null } } },
      none: { seasonSlot: { eventSlot: { sportEvent: { startDate: { gte: lastEventStartedBefore } } } } },
    },
  };
}

function mapToContest(row: {
  id: string;
  leagueId: string;
  sportLeagueSeasonId: string;
  sportLeagueSeason: { championshipYear: number; sportLeague: SportLeagueSportRow };
  seasonSlots: { sportLeagueSeasonCompetitionSlotId: string; seasonSlot: { sportLeagueCompetitionSlotId: string; eventSlot: { sportEventId: string } | null } }[];
  name: string;
  status: ContestStatus;
  contestFormat: ContestFormat;
  selectionType: SelectionType;
  draw?: { drawnAt: Date } | null;
  squaresGame?: { sportEventRoundMatchId: string } | null;
  squaresDraw?: { drawnAt: Date } | null;
  openedAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  cupWeight: CupWeight;
  createdAt: Date;
  updatedAt: Date;
}): Contest {
  const { sport } = row.sportLeagueSeason.sportLeague;
  return {
    id: row.id,
    leagueId: row.leagueId,
    // The covered slots' events, each once, in the order the slots are played.
    sportEventIds: [...new Set(row.seasonSlots.flatMap(({ seasonSlot }) => (seasonSlot.eventSlot ? [seasonSlot.eventSlot.sportEventId] : [])))],
    coveredSlotDefinitionIds: row.seasonSlots.map(({ seasonSlot }) => seasonSlot.sportLeagueCompetitionSlotId),
    coveredSeasonSlotIds: row.seasonSlots.map((covered) => covered.sportLeagueSeasonCompetitionSlotId),
    name: row.name,
    status: row.status,
    contestFormat: row.contestFormat,
    selectionType: row.selectionType,
    sport: sport.sport,
    sportUrlSegment: sport.urlSegment,
    openedAt: row.openedAt ?? undefined,
    startsAt: row.startsAt ?? undefined,
    endsAt: row.endsAt ?? undefined,
    // A contest has at most one of the two draws: a random draw's deal or squares' digits.
    drawnAt: row.draw?.drawnAt ?? row.squaresDraw?.drawnAt ?? undefined,
    squaresGameMatchId: row.squaresGame?.sportEventRoundMatchId ?? undefined,
    sportLeagueSeasonId: row.sportLeagueSeasonId,
    seasonYear: row.sportLeagueSeason.championshipYear,
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
  // A contest's Season names its sport league (#2014): the league's Seasons of that year with a contest.
  const rows = await db.sportLeagueSeason.findMany({
    where: { championshipYear: seasonYear, contests: { some: { leagueId } } },
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
  // poolmaster-allow-raw-sql: a row lock (SELECT … FOR UPDATE): Prisma has no row locks
  await tx.$queryRaw`SELECT id FROM "leagues" WHERE id = ${leagueId}::uuid FOR UPDATE`;
  const used = await sportLeagueIdsBySeason(tx, leagueId, seasonYear);
  return used.includes(limits.sportLeagueId) || used.length < limits.sportLeaguesPerYear
    ? null
    : { status: 'sportsLeagueLimitReached', sportLeaguesPerYear: limits.sportLeaguesPerYear, sportLeagueCount: used.length };
}

/** The columns a status move writes: the status, and each moment it sets. */
function toStatusTransitionData(transition: ContestStatusTransition): Prisma.ContestUpdateManyMutationInput {
  return {
    status: transition.to,
    ...(transition.openedAt && { openedAt: transition.openedAt }),
    ...(transition.nextReminderAt && { nextReminderAt: transition.nextReminderAt }),
    ...(transition.startsAt && { startsAt: transition.startsAt }),
    ...(transition.endsAt && { endsAt: transition.endsAt }),
  };
}
