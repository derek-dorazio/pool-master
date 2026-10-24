/**
 * Prisma adapter for the ChampionshipRepository port (#863).
 */

import type { PrismaClient } from '@prisma/client';
import type { ChampionshipRepository, FinalContest, SeriesContest } from '@poolmaster/shared/db';
import { ContestStatus, CupWeight, type LeagueYearFinish } from '@poolmaster/shared/domain';

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

  async findByLeagueYear(leagueId: string, year: number): Promise<LeagueYearFinish[]> {
    return this.prisma.leagueYearFinish.findMany({
      where: { leagueId, year },
      orderBy: [{ settledAt: 'asc' }, { contestId: 'asc' }],
      select: FINISH_SELECT,
    });
  }

  async findCupName(leagueId: string): Promise<string | null> {
    const row = await this.prisma.league.findUnique({ where: { id: leagueId }, select: { cupName: true } });
    return row?.cupName ?? null;
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
        sportEvents: { where: { sequence: 1 }, select: { sportEvent: { select: { eventSeries: { select: { sportLeague: { select: { name: true } } } } } } } },
      },
    });
    // Every event of a contest is one sports league's, so the first event names it.
    return rows.flatMap((row) => {
      const firstEvent = row.sportEvents.at(0);
      return firstEvent === undefined ? [] : [{
        id: row.id,
        name: row.name,
        selectionType: row.selectionType,
        sportLeagueName: firstEvent.sportEvent.eventSeries.sportLeague.name,
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
                eventYear: true,
                eventSeries: { select: { id: true, name: true, sportLeague: { select: { name: true } } } },
                matches: { select: { advancesToMatchId: true, sportEventRound: { select: { roundNumber: true } } } },
              },
            },
          },
        },
      },
    });
    return rows.flatMap((row) => {
      const only = row.sportEvents.length === 1 ? row.sportEvents[0]?.sportEvent : undefined;
      return only === undefined ? [] : [{
        id: row.id,
        selectionType: row.selectionType,
        cupWeight: row.cupWeight,
        eventSeriesId: only.eventSeries.id,
        seriesName: only.eventSeries.name,
        sportLeagueName: only.eventSeries.sportLeague.name,
        eventYear: only.eventYear,
        completedAt: row.endsAt,
        games: only.matches.map((match) => ({ roundNumber: match.sportEventRound.roundNumber, sendsWinnerOn: match.advancesToMatchId !== null })),
      }];
    });
  }
}
