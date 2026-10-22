/**
 * Prisma adapter for the CupRepository port (#841).
 */

import type { PrismaClient } from '@prisma/client';
import type { CupContest, CupKey, CupRankedEntry, CupRepository } from '@poolmaster/shared/db';
import { ContestStatus, type Cup, type CupPointsTable } from '@poolmaster/shared/domain';

const CUP_SELECT = { id: true, leagueId: true, seasonYear: true, sportLeagueId: true, createdAt: true } as const;

export class PrismaCupRepository implements CupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async ensure(key: CupKey): Promise<Cup> {
    return this.prisma.cup.upsert({
      where: { leagueId_seasonYear_sportLeagueId: key },
      create: key,
      update: {},
      select: CUP_SELECT,
    });
  }

  async findById(id: string): Promise<Cup | null> {
    return this.prisma.cup.findUnique({ where: { id }, select: CUP_SELECT });
  }

  async findByLeagueSeason(leagueId: string, seasonYear: number): Promise<Cup[]> {
    return this.prisma.cup.findMany({
      where: { leagueId, seasonYear },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: CUP_SELECT,
    });
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

  async findPointsTable(leagueId: string): Promise<CupPointsTable | null> {
    const row = await this.prisma.league.findUnique({
      where: { id: leagueId },
      select: { cupPointsScale: true, cupCustomPoints: true },
    });
    return row === null ? null : { scale: row.cupPointsScale, customPoints: row.cupCustomPoints };
  }
}
