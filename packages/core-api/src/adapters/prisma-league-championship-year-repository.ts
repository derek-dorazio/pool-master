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
import { type ChampionshipCalendarInput, type ChampionshipYearContests, ContestStatus, SeasonSlotStatus } from '@poolmaster/shared/domain';
import { neverOpeningDraft } from './never-opening-draft';
import { SLOT_PLACE_SELECT, slotPlaceOf } from './slot-place-select';

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

  async readCalendarInput(leagueId: string, now: Date): Promise<ChampionshipCalendarInput> {
    const counted = { leagueId, NOT: neverOpeningDraft(now) };
    const [contests, closedRows, currentSeasons] = await Promise.all([
      this.prisma.contest.findMany({
        where: counted,
        select: { id: true, name: true, status: true, championshipYear: true, sportLeagueSeason: { select: { sportLeagueId: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.leagueChampionshipYear.findMany({ where: { leagueId }, select: { championshipYear: true } }),
      this.prisma.sportLeague.findMany({
        where: { isActive: true, currentSeasonId: { not: null } },
        select: { currentSeason: { select: { championshipYear: true } } },
      }),
    ]);
    const closedYears = closedRows.map((row) => row.championshipYear);
    const closed = new Set(closedYears);
    const years = new Map<number, ChampionshipYearContests & { sportLeagueIds: Set<string> }>();
    for (const contest of contests) {
      const year = years.get(contest.championshipYear)
        ?? { championshipYear: contest.championshipYear, hasLiveContest: false, unfinishedContests: [], sportLeagueIds: new Set<string>() };
      years.set(contest.championshipYear, year);
      year.sportLeagueIds.add(contest.sportLeagueSeason.sportLeagueId);
      if (contest.status === ContestStatus.ACTIVE) year.hasLiveContest = true;
      if (contest.status !== ContestStatus.COMPLETED) year.unfinishedContests.push({ id: contest.id, name: contest.name });
    }
    const openYears = [...years.values()].filter((year) => !closed.has(year.championshipYear));
    // The same slots `readYearState` counts, for every open year at once (none for no open year).
    const slots = await this.prisma.sportLeagueSeasonCompetitionSlot.findMany({
      where: {
        status: { in: UNFINISHED_SLOT_STATUSES },
        season: { OR: openYears.map((year) => ({ championshipYear: year.championshipYear, sportLeagueId: { in: [...year.sportLeagueIds] } })) },
        OR: [{ isTestData: false }, { contestSlots: { some: { contest: counted } } }],
      },
      select: {
        startsAt: true,
        endsAt: true,
        isTestData: true,
        label: true,
        season: { select: { championshipYear: true, sportLeague: { select: { id: true, name: true } } } },
        definition: { select: { key: true, name: true, slotKind: true, weekNumber: true, ...SLOT_PLACE_SELECT } },
      },
    });
    return {
      contestYears: [...years.values()].map((year) => ({ championshipYear: year.championshipYear, hasLiveContest: year.hasLiveContest, unfinishedContests: year.unfinishedContests })),
      closedYears,
      unfinishedSlots: slots.map((slot) => {
        const place = slotPlaceOf(slot.definition);
        return {
          championshipYear: slot.season.championshipYear,
          sportLeagueId: slot.season.sportLeague.id,
          sportLeagueName: slot.season.sportLeague.name,
          phase: place.phase,
          competitionOrderIndex: place.competitionOrderIndex,
          key: slot.definition.key,
          slotKind: slot.definition.slotKind,
          weekNumber: slot.definition.weekNumber,
          name: slot.definition.name,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          isTestData: slot.isTestData,
          label: slot.label,
        };
      }),
      currentSeasonYears: currentSeasons.flatMap((row) => (row.currentSeason === null ? [] : [row.currentSeason.championshipYear])),
    };
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
    // One key per league: a Season has one championship year, so its contests all share it.
    const rows = await this.prisma.contest.findMany({
      where: { sportLeagueSeasonId: slot.sportLeagueSeasonId },
      select: { leagueId: true, championshipYear: true },
      distinct: ['leagueId'],
      orderBy: { leagueId: 'asc' },
    });
    return rows;
  }
}
