/**
 * Prisma adapter for the ChampionshipRepository port (#863).
 */

import type { PrismaClient } from '@prisma/client';
import type { ChampionshipRepository, FinalContest, FinalContestFilter, SeriesContest } from '@poolmaster/shared/db';
import { compareCoveredSlots, ContestStatus, CupWeight, type LeagueYearFinish } from '@poolmaster/shared/domain';
import { SLOT_PLACE_SELECT, slotPlaceOf } from './slot-place-select';

/** A slot definition with what puts it in play order. */
const TROPHY_DEFINITION_SELECT = { id: true, key: true, name: true, slotKind: true, weekNumber: true, ...SLOT_PLACE_SELECT } as const;

const FINISH_SELECT = {
  leagueId: true,
  year: true,
  squadId: true,
  contestId: true,
  place: true,
  tiedCount: true,
  rankedEntryCount: true,
  weight: true,
  points: true,
  settledAt: true,
} as const;

export class PrismaChampionshipRepository implements ChampionshipRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async recordFinishes(finishes: readonly LeagueYearFinish[]): Promise<number> {
    if (finishes.length === 0) {
      return 0;
    }
    // Settlement can run twice for one contest (an event re-sent as final): the first write stands.
    const result = await this.prisma.leagueYearFinish.createMany({ data: [...finishes], skipDuplicates: true });
    return result.count;
  }

  async findByLeague(leagueId: string): Promise<LeagueYearFinish[]> {
    return this.prisma.leagueYearFinish.findMany({
      where: { leagueId },
      orderBy: [{ settledAt: 'asc' }, { contestId: 'asc' }],
      select: FINISH_SELECT,
    });
  }

  async findByLeagueYear(leagueId: string, year: number, settledSince?: Date): Promise<LeagueYearFinish[]> {
    return this.prisma.leagueYearFinish.findMany({
      where: { leagueId, year, ...(settledSince === undefined ? {} : { settledAt: { gte: settledSince } }) },
      orderBy: [{ settledAt: 'asc' }, { contestId: 'asc' }],
      select: FINISH_SELECT,
    });
  }

  async hasCountedFinish(leagueId: string, year: number): Promise<boolean> {
    const row = await this.prisma.leagueYearFinish.findFirst({
      where: { leagueId, year, weight: { not: CupWeight.NOT_COUNTED } },
      select: { contestId: true },
    });
    return row !== null;
  }

  async countUnfinishedContestsByYear(leagueId: string): Promise<ReadonlyMap<number, number>> {
    const rows = await this.prisma.contest.groupBy({
      by: ['championshipYear'],
      where: {
        leagueId,
        status: { in: [ContestStatus.OPEN, ContestStatus.ACTIVE] },
        cupWeight: { not: CupWeight.NOT_COUNTED },
      },
      _count: { _all: true },
      orderBy: { championshipYear: 'asc' },
    });
    return new Map(rows.map((row) => [row.championshipYear, row._count._all]));
  }

  async findFinalContests(leagueId: string, filter: FinalContestFilter): Promise<FinalContest[]> {
    const rows = await this.prisma.contest.findMany({
      where: {
        leagueId,
        status: ContestStatus.COMPLETED,
        ...('championshipYear' in filter ? { championshipYear: filter.championshipYear, ...finishedSinceWhere(filter.finishedSince) } : { id: { in: [...filter.contestIds] } }),
      },
      select: {
        id: true,
        name: true,
        selectionType: true,
        endsAt: true,
        championshipYear: true,
        // A contest's Season names its sports league (#2014).
        sportLeagueSeason: { select: { sportLeague: { select: { name: true } } } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      selectionType: row.selectionType,
      sportLeagueName: row.sportLeagueSeason.sportLeague.name,
      completedAt: row.endsAt,
      championshipYear: row.championshipYear,
    }));
  }

  async findSeriesContests(leagueId: string): Promise<SeriesContest[]> {
    const rows = await this.prisma.contest.findMany({
      where: { leagueId, status: ContestStatus.COMPLETED },
      select: {
        id: true,
        selectionType: true,
        cupWeight: true,
        endsAt: true,
        sportLeagueSeason: { select: { championshipYear: true, sportLeague: { select: { name: true } } } },
        seasonSlots: {
          select: {
            seasonSlot: {
              select: {
                eventSlot: {
                  select: {
                    sportEvent: {
                      select: {
                        id: true,
                        name: true,
                        // The slot definitions the event covers key its trophy until #2024 (#2010).
                        slots: { select: { seasonSlot: { select: { definition: { select: TROPHY_DEFINITION_SELECT } } } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    // Only a contest on one event has a series: its covered slots' events, each once.
    const contests = rows.flatMap((row) => {
      const events = [...new Map(row.seasonSlots.flatMap(({ seasonSlot }) => (seasonSlot.eventSlot ? [seasonSlot.eventSlot.sportEvent] : []))
        .map((event) => [event.id, event])).values()];
      return events.length === 1 ? events.map((event) => ({ row, event })) : [];
    });
    // The games are counted per event and round rather than read game by game.
    const rounds = contests.length === 0 ? [] : await this.prisma.sportEventRoundMatch.groupBy({
      by: ['sportEventId', 'sportEventRoundId'],
      where: { sportEventId: { in: [...new Set(contests.map(({ event }) => event.id))] } },
      _count: { _all: true, advancesToMatchId: true },
    });
    const gamesByEvent = new Map<string, SeriesContest['games']>();
    for (const round of rounds) {
      const games = gamesByEvent.get(round.sportEventId) ?? { count: 0, roundCount: 0, sendingWinnerOn: 0 };
      gamesByEvent.set(round.sportEventId, {
        count: games.count + round._count._all,
        roundCount: games.roundCount + 1,
        sendingWinnerOn: games.sendingWinnerOn + round._count.advancesToMatchId,
      });
    }
    return contests.map(({ row, event }) => ({
      id: row.id,
      selectionType: row.selectionType,
      cupWeight: row.cupWeight,
      ...coveredDefinitions(event.slots.map(({ seasonSlot }) => ({ ...seasonSlot.definition, ...slotPlaceOf(seasonSlot.definition) }))),
      eventName: event.name,
      sportLeagueName: row.sportLeagueSeason.sportLeague.name,
      championshipYear: row.sportLeagueSeason.championshipYear,
      completedAt: row.endsAt,
      games: gamesByEvent.get(event.id) ?? { count: 0, roundCount: 0, sendingWinnerOn: 0 },
    }));
  }
}

/** An event's slot definitions in play order, and the first one's proper name. */
function coveredDefinitions(definitions: (Parameters<typeof compareCoveredSlots>[0] & { id: string; name: string | null })[]): Pick<SeriesContest, 'slotDefinitionIds' | 'slotName'> {
  const inPlayOrder = [...definitions].sort(compareCoveredSlots);
  return { slotDefinitionIds: inPlayOrder.map((definition) => definition.id), slotName: inPlayOrder[0]?.name ?? null };
}

/**
 * Went final at or after `since`: its end, or for a contest with no end its first settled finish,
 * as the history list dates a contest.
 */
function finishedSinceWhere(since: Date | undefined) {
  return since === undefined ? {} : {
    OR: [{ endsAt: { gte: since } }, { endsAt: null, yearFinishes: { some: { settledAt: { gte: since } } } }],
  };
}
