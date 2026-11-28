/**
 * Prisma adapter for the LeagueChampionshipYearRepository port (#2021): a league's closed
 * championship years and what still holds a year open.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  ChampionshipYearState,
  ClosedChampionshipYear,
  LeagueChampionshipYearKey,
  LeagueChampionshipYearRepository,
} from '@poolmaster/shared/db';
import { type ChampionshipCalendarInput, ContestStatus, SeasonSlotStatus } from '@poolmaster/shared/domain';
import { neverOpeningDraft } from './never-opening-draft';
import { SLOT_PLACE_SELECT, slotPlaceOf } from './slot-place-select';

/** A Season slot still to play: neither finished nor called off. */
const UNFINISHED_SLOT_STATUSES = [SeasonSlotStatus.SCHEDULED, SeasonSlotStatus.IN_PROGRESS];

/**
 * The one rule for the Season slots that hold a league's championship year open, as the year close
 * counts them and the calendar names them: still to play, in the given Seasons, and either synced
 * or a test slot one of the league's counted contests covers.
 */
function unfinishedYearSlotsWhere(counted: Prisma.ContestWhereInput, season: Prisma.SportLeagueSeasonWhereInput): Prisma.SportLeagueSeasonCompetitionSlotWhereInput {
  return {
    status: { in: UNFINISHED_SLOT_STATUSES },
    season,
    OR: [{ isTestData: false }, { contestSlots: { some: { contest: counted } } }],
  };
}

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
    // The years come grouped, so finished contests are never read row by row; only the year's
    // unfinished contests are, which settle away.
    const [seasons, unfinished, closedRows, currentSeasons] = await Promise.all([
      this.prisma.contest.groupBy({ by: ['championshipYear', 'sportLeagueSeasonId'], where: counted, orderBy: [{ championshipYear: 'asc' }, { sportLeagueSeasonId: 'asc' }] }),
      this.prisma.contest.findMany({
        where: { ...counted, status: { not: ContestStatus.COMPLETED } },
        select: { id: true, name: true, status: true, championshipYear: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.leagueChampionshipYear.findMany({ where: { leagueId }, select: { championshipYear: true } }),
      // Every active sport league's, not only this league's: a league with no contests has none of its own.
      this.prisma.sportLeague.findMany({
        where: { isActive: true, currentSeasonId: { not: null } },
        select: { currentSeason: { select: { championshipYear: true } } },
      }),
    ]);
    const closedYears = closedRows.map((row) => row.championshipYear);
    const closed = new Set(closedYears);
    // The same slots `readYearState` counts, for every open year's Seasons at once (none for no open year).
    const openSeasonIds = seasons.filter((row) => !closed.has(row.championshipYear)).map((row) => row.sportLeagueSeasonId);
    const slots = await this.prisma.sportLeagueSeasonCompetitionSlot.findMany({
      where: unfinishedYearSlotsWhere(counted, { id: { in: openSeasonIds } }),
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
      contestYears: [...new Set(seasons.map((row) => row.championshipYear))],
      unfinishedContests: unfinished,
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
      where: unfinishedYearSlotsWhere(counted, { championshipYear, sportLeagueId: { in: sportLeagueIds } }),
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
