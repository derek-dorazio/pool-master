/**
 * Prisma adapter for the CupRepository port (#841).
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { CupContest, CupContestFinish, CupKey, CupRankedEntry, CupRepository } from '@poolmaster/shared/db';
import { ContestStatus, CupStatus, type Cup, type CupPointsTable, type CupStanding } from '@poolmaster/shared/domain';

const CUP_SELECT = {
  id: true,
  leagueId: true,
  seasonYear: true,
  sportLeagueId: true,
  status: true,
  crownedAt: true,
  crownedPointsScale: true,
  crownedCustomPoints: true,
  createdAt: true,
} as const;

type CupRow = Prisma.CupGetPayload<{ select: typeof CUP_SELECT }>;

function toCup(row: CupRow): Cup {
  return {
    id: row.id,
    leagueId: row.leagueId,
    seasonYear: row.seasonYear,
    sportLeagueId: row.sportLeagueId,
    status: row.status,
    crownedAt: row.crownedAt,
    crownedPointsTable: row.crownedPointsScale === null ? null : { scale: row.crownedPointsScale, customPoints: row.crownedCustomPoints },
    createdAt: row.createdAt,
  };
}

export class PrismaCupRepository implements CupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async ensure(key: CupKey): Promise<Cup> {
    return toCup(await this.prisma.cup.upsert({
      where: { leagueId_seasonYear_sportLeagueId: key },
      create: key,
      update: {},
      select: CUP_SELECT,
    }));
  }

  async findById(id: string): Promise<Cup | null> {
    const row = await this.prisma.cup.findUnique({ where: { id }, select: CUP_SELECT });
    return row === null ? null : toCup(row);
  }

  async findByLeagueSeason(leagueId: string, seasonYear: number): Promise<Cup[]> {
    const rows = await this.prisma.cup.findMany({
      where: { leagueId, seasonYear },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: CUP_SELECT,
    });
    return rows.map(toCup);
  }

  async findSeasonYears(leagueId: string): Promise<number[]> {
    // Every contest with an event has its season's cup (contest creation ensures it), so the
    // seasons of the league's listed contests are the seasons with a cup to show.
    const rows = await this.prisma.contest.findMany({
      where: { leagueId, status: { not: ContestStatus.DRAFT }, sportEvents: { some: { sequence: 1 } } },
      distinct: ['seasonYear'],
      orderBy: { seasonYear: 'desc' },
      select: { seasonYear: true },
    });
    return rows.map((row) => row.seasonYear);
  }

  async findContests(key: CupKey): Promise<CupContest[]> {
    // Every event of a contest is one sports league's (contest creation refuses a mix), so the
    // first event's series names the contest's sports league.
    const rows = await this.prisma.contest.findMany({
      where: {
        leagueId: key.leagueId,
        seasonYear: key.seasonYear,
        status: { not: ContestStatus.DRAFT },
        sportEvents: { some: { sequence: 1, sportEvent: { eventSeries: { sportLeagueId: key.sportLeagueId } } } },
      },
      select: {
        id: true,
        name: true,
        status: true,
        selectionType: true,
        cupWeight: true,
        endsAt: true,
        sportEvents: { where: { sequence: 1 }, select: { sportEvent: { select: { startDate: true } } } },
      },
    });
    return rows
      .flatMap((row) => {
        const firstEvent = row.sportEvents.at(0);
        return firstEvent === undefined ? [] : [{
          id: row.id,
          name: row.name,
          status: row.status,
          selectionType: row.selectionType,
          cupWeight: row.cupWeight,
          firstEventStartsAt: firstEvent.sportEvent.startDate,
          completedAt: row.status === ContestStatus.COMPLETED ? row.endsAt : null,
        }];
      })
      .sort((left, right) => left.firstEventStartsAt.getTime() - right.firstEventStartsAt.getTime() || left.id.localeCompare(right.id));
  }

  async findRankedEntries(contestIds: readonly string[]): Promise<CupRankedEntry[]> {
    if (contestIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.contestEntryStanding.findMany({
      where: { contestId: { in: [...contestIds] }, position: { not: null } },
      select: { contestId: true, position: true, contestEntry: { select: { squadId: true } } },
    });
    return rows.flatMap((row) => row.position === null
      ? []
      : [{ contestId: row.contestId, squadId: row.contestEntry.squadId, position: row.position }]);
  }

  async findFinishes(contestIds: readonly string[]): Promise<CupContestFinish[]> {
    if (contestIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.leagueYearFinish.findMany({
      where: { contestId: { in: [...contestIds] } },
      select: { contestId: true, squadId: true, place: true, tiedCount: true, rankedEntryCount: true, weight: true, createdAt: true },
    });
    return rows.map(({ createdAt, ...row }) => ({ ...row, recordedAt: createdAt }));
  }

  async findStandings(cupId: string): Promise<CupStanding[]> {
    return this.prisma.cupStanding.findMany({
      where: { cupId },
      orderBy: [{ position: 'asc' }, { squadId: 'asc' }],
      select: {
        cupId: true,
        squadId: true,
        position: true,
        displayPosition: true,
        points: true,
        wins: true,
        podiums: true,
        contestsCounted: true,
        trophy: true,
      },
    });
  }

  async crown(
    cupId: string,
    crowning: { crownedAt: Date; pointsTable: CupPointsTable; standings: readonly CupStanding[] },
  ): Promise<Cup | null> {
    return this.prisma.$transaction(async (tx) => {
      // Guarded on OPEN, so of two crownings racing only one writes.
      const { count } = await tx.cup.updateMany({
        where: { id: cupId, status: CupStatus.OPEN },
        data: {
          status: CupStatus.CROWNED,
          crownedAt: crowning.crownedAt,
          crownedPointsScale: crowning.pointsTable.scale,
          crownedCustomPoints: [...crowning.pointsTable.customPoints],
        },
      });
      if (count === 0) {
        return null;
      }
      await tx.cupStanding.createMany({ data: crowning.standings.map((standing) => ({ ...standing, cupId })) });
      return toCup(await tx.cup.findUniqueOrThrow({ where: { id: cupId }, select: CUP_SELECT }));
    });
  }

  async findPointsTable(leagueId: string): Promise<CupPointsTable | null> {
    const row = await this.prisma.league.findUnique({
      where: { id: leagueId },
      select: { cupPointsScale: true, cupCustomPoints: true },
    });
    return row === null ? null : { scale: row.cupPointsScale, customPoints: row.cupCustomPoints };
  }
}
