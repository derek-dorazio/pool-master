/**
 * Prisma adapter for the LeagueChampionshipYearRepository port (#2021): a league's closed
 * championship years and what still holds a year open.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  ChampionshipYearState,
  ClosedChampionshipYear,
  LeagueChampionshipYearKey,
  LeagueChampionshipYearRepository,
} from '@poolmaster/shared/db';
import { ContestStatus, SeasonSlotStatus } from '@poolmaster/shared/domain';
import { neverOpeningDraft } from './never-opening-draft';

/** A Season slot still to play: neither finished nor called off. */
const UNFINISHED_SLOT_STATUSES = [SeasonSlotStatus.SCHEDULED, SeasonSlotStatus.IN_PROGRESS];

export class PrismaLeagueChampionshipYearRepository implements LeagueChampionshipYearRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findClosedYears(leagueId: string): Promise<ClosedChampionshipYear[]> {
    return this.prisma.leagueChampionshipYear.findMany({
      where: { leagueId },
      select: { championshipYear: true, closedAt: true },
      orderBy: { championshipYear: 'desc' },
    });
  }

  async isClosed({ leagueId, championshipYear }: LeagueChampionshipYearKey): Promise<boolean> {
    const row = await this.prisma.leagueChampionshipYear.findUnique({
      where: { leagueId_championshipYear: { leagueId, championshipYear } },
      select: { id: true },
    });
    return row !== null;
  }

  async readYearState({ leagueId, championshipYear }: LeagueChampionshipYearKey, now: Date): Promise<ChampionshipYearState> {
    const counted = { leagueId, championshipYear, NOT: neverOpeningDraft(now) };
    const contests = await this.prisma.contest.findMany({
      where: counted,
      select: { status: true, sportLeagueSeason: { select: { sportLeagueId: true } } },
    });
    const sportLeagueIds = [...new Set(contests.map((contest) => contest.sportLeagueSeason.sportLeagueId))];
    // Every synced slot of the year counts, placed on an event or not: a round not yet drawn has
    // no event, and a closed year never reopens, so a year must never close before its last slot.
    // A slot that will never be played is cancelled (feed or root admin), which releases the year.
    const unfinishedSeasonSlotCount = sportLeagueIds.length === 0 ? 0 : await this.prisma.sportLeagueSeasonCompetitionSlot.count({
      where: {
        status: { in: UNFINISHED_SLOT_STATUSES },
        season: { championshipYear, sportLeagueId: { in: sportLeagueIds } },
        OR: [{ isTestData: false }, { contestSlots: { some: { contest: counted } } }],
      },
    });
    return {
      contestCount: contests.length,
      unfinishedContestCount: contests.filter((contest) => contest.status !== ContestStatus.COMPLETED).length,
      unfinishedSeasonSlotCount,
    };
  }

  async close({ leagueId, championshipYear }: LeagueChampionshipYearKey, closedAt: Date): Promise<boolean> {
    // The unique key lets one close through; a year closed already keeps its first close.
    const { count } = await this.prisma.leagueChampionshipYear.createMany({
      data: [{ leagueId, championshipYear, closedAt }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  async findContestYear(contestId: string): Promise<LeagueChampionshipYearKey | null> {
    return this.prisma.contest.findUnique({ where: { id: contestId }, select: { leagueId: true, championshipYear: true } });
  }

  async findLeagueYearsOfSeasonSlot(seasonSlotId: string): Promise<LeagueChampionshipYearKey[]> {
    const slot = await this.prisma.sportLeagueSeasonCompetitionSlot.findUnique({
      where: { id: seasonSlotId },
      select: { sportLeagueSeasonId: true },
    });
    if (slot === null) return [];
    const rows = await this.prisma.contest.findMany({
      where: { sportLeagueSeasonId: slot.sportLeagueSeasonId },
      select: { leagueId: true, championshipYear: true },
      distinct: ['leagueId'],
      orderBy: { leagueId: 'asc' },
    });
    return rows;
  }
}
