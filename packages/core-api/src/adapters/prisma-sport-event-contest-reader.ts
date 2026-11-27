/**
 * Prisma adapter for the contests on one sport event (#1889): one read of the contests covering
 * its slots (#2014) with each contest's league and template, and one count of their entries grouped by
 * contest, however many there are. The count filters by contest id, so it reads only those
 * contests' entries; a nested `_count` would group every entry in the table.
 */
import type { PrismaClient } from '@prisma/client';
import type { SportEventContestReader } from '@poolmaster/shared/db';
import type { SportEventContest } from '@poolmaster/shared/domain';
import { coversEventWhere } from './prisma-contest-repository';

export class PrismaSportEventContestReader implements SportEventContestReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findContests(sportEventId: string): Promise<SportEventContest[]> {
    const rows = await this.prisma.contest.findMany({
      where: coversEventWhere(sportEventId),
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        league: { select: { id: true, leagueCode: true, name: true } },
        configuration: { select: { template: { select: { id: true, name: true } } } },
      },
    });
    const contestIds = rows.map((contest) => contest.id);
    const counts = contestIds.length
      ? await this.prisma.contestEntry.groupBy({ by: ['contestId'], where: { contestId: { in: contestIds } }, _count: { _all: true } })
      : [];
    const entryCounts = new Map(counts.map((row) => [row.contestId, row._count._all]));
    return rows.map((contest) => ({
      id: contest.id,
      name: contest.name,
      status: contest.status,
      league: contest.league,
      contestTemplate: contest.configuration?.template ?? null,
      entryCount: entryCounts.get(contest.id) ?? 0,
      createdAt: contest.createdAt,
    }));
  }
}
