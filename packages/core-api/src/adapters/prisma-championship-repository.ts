/**
 * Prisma adapter for the ChampionshipRepository port (#863).
 */

import type { PrismaClient } from '@prisma/client';
import type { ChampionshipRepository } from '@poolmaster/shared/db';
import { ContestStatus, CupWeight, type LeagueYearFinish } from '@poolmaster/shared/domain';

const FINISH_SELECT = {
  leagueId: true,
  year: true,
  squadId: true,
  contestId: true,
  place: true,
  tiedCount: true,
  rankedEntryCount: true,
  eventSeriesId: true,
  selectionType: true,
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

  async findSingleEventSeries(contestId: string): Promise<string | null> {
    const events = await this.prisma.contestSportEvent.findMany({
      where: { contestId },
      select: { sportEvent: { select: { eventSeriesId: true } } },
      take: 2,
    });
    return events.length === 1 ? events[0]?.sportEvent.eventSeriesId ?? null : null;
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
}
