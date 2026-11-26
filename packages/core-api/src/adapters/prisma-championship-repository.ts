/**
 * Prisma adapter for the ChampionshipRepository port (#863).
 */

import type { PrismaClient } from '@prisma/client';
import type { ChampionshipRepository, FinalContest, SeriesContest } from '@poolmaster/shared/db';
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

  async countUnfinishedContests(leagueId: string): Promise<number> {
    return this.prisma.contest.count({
      where: {
        leagueId,
        status: { in: [ContestStatus.OPEN, ContestStatus.ACTIVE] },
        cupWeight: { not: CupWeight.NOT_COUNTED },
      },
    });
  }

  async findFinalContests(leagueId: string, from: Date, to: Date, contestIds: readonly string[]): Promise<FinalContest[]> {
    const rows = await this.prisma.contest.findMany({
      where: {
        leagueId,
        status: ContestStatus.COMPLETED,
        OR: [{ endsAt: { gte: from, lt: to } }, { id: { in: [...contestIds] } }],
      },
      select: {
        id: true,
        name: true,
        selectionType: true,
        endsAt: true,
        sportEvents: { where: { sequence: 1 }, select: { sportEvent: { select: { sportLeagueSeason: { select: { sportLeague: { select: { name: true } } } } } } } },
      },
    });
    // Every event of a contest is one sports league's, so the first event names it.
    return rows.flatMap((row) => {
      const firstEvent = row.sportEvents.at(0);
      return firstEvent === undefined ? [] : [{
        id: row.id,
        name: row.name,
        selectionType: row.selectionType,
        sportLeagueName: firstEvent.sportEvent.sportLeagueSeason.sportLeague.name,
        completedAt: row.endsAt,
      }];
    });
  }

  async findSeriesContests(leagueId: string): Promise<SeriesContest[]> {
    const rows = await this.prisma.contest.findMany({
      where: { leagueId, status: ContestStatus.COMPLETED },
      select: {
        id: true,
        selectionType: true,
        cupWeight: true,
        endsAt: true,
        sportEvents: {
          take: 2,
          select: {
            sportEvent: {
              select: {
                id: true,
                name: true,
                sportLeagueSeason: { select: { championshipYear: true, sportLeague: { select: { name: true } } } },
                // The slot definitions the event covers key its trophy until #2024 (#2010).
                slots: { select: { seasonSlot: { select: { definition: { select: TROPHY_DEFINITION_SELECT } } } } },
              },
            },
          },
        },
      },
    });
    const contests = rows.flatMap((row) => {
      const only = row.sportEvents.length === 1 ? row.sportEvents[0]?.sportEvent : undefined;
      return only === undefined ? [] : [{ row, event: only }];
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
      sportLeagueName: event.sportLeagueSeason.sportLeague.name,
      championshipYear: event.sportLeagueSeason.championshipYear,
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
