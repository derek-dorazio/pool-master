/**
 * Prisma adapter for the contests on one sport event (#1889): one read of the event's contest
 * links with each contest's league, template and entry count, however many there are.
 */
import type { PrismaClient } from '@prisma/client';
import type { SportEventContestReader } from '@poolmaster/shared/db';
import type { SportEventContest } from '@poolmaster/shared/domain';

export class PrismaSportEventContestReader implements SportEventContestReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findContests(sportEventId: string): Promise<SportEventContest[]> {
    const rows = await this.prisma.contestSportEvent.findMany({
      where: { sportEventId },
      orderBy: [{ contest: { createdAt: 'desc' } }, { contestId: 'asc' }],
      select: {
        contest: {
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
            league: { select: { id: true, name: true } },
            configuration: { select: { template: { select: { id: true, name: true } } } },
            _count: { select: { entries: true } },
          },
        },
      },
    });
    return rows.map(({ contest }) => ({
      id: contest.id,
      name: contest.name,
      status: contest.status,
      league: contest.league,
      contestTemplate: contest.configuration?.template ?? null,
      entryCount: contest._count.entries,
      createdAt: contest.createdAt,
    }));
  }
}
