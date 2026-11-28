/**
 * A league's championship calendar (#2021): its championship years, open or closed, the year it is
 * in now and what still holds each open year open. Read from its contests, its closed years and
 * the sport leagues' Seasons, never from the clock, so every screen names the same year.
 */
import { ContestStatus, type LeaguePhase } from './enums';
import { compareSeasonSlots, type SportLeagueSeasonSlot } from './sport-league-seasons';
import { compareSlotPlaces } from './sport-league-structure';

/** A Season slot of a championship year still to finish, where its Season plays it. */
export interface UnfinishedYearSlot extends Pick<SportLeagueSeasonSlot, 'key' | 'slotKind' | 'weekNumber' | 'name' | 'startsAt' | 'endsAt' | 'isTestData' | 'label'> {
  championshipYear: number;
  sportLeagueId: string;
  /** What screens call the sport league, such as "NFL". */
  sportLeagueName: string;
  phase: LeaguePhase;
  /** Its competition's place in the phase. */
  competitionOrderIndex: number;
}

/** A contest of the year not yet final, named as screens name it. */
export interface UnfinishedYearContest {
  id: string;
  name: string;
}

/** A counted contest of the league not yet final, with its year and status. */
export interface UnfinishedContest extends UnfinishedYearContest {
  championshipYear: number;
  status: ContestStatus;
}

/** One year of the calendar. */
export interface ChampionshipCalendarYear {
  championshipYear: number;
  /** Closed for good: every contest in it final and every Season slot of it finished. */
  isClosed: boolean;
  /**
   * Each sport league's last slot of the year still to finish, the one whose end closes the year
   * once its contests are final: earliest date first, an undated slot last. Empty once closed.
   */
  closesAfter: UnfinishedYearSlot[];
  /** Its contests not yet final; empty once closed. */
  unfinishedContests: UnfinishedYearContest[];
}

export interface ChampionshipCalendar {
  /**
   * The year the league is in now: the earliest open year with a live contest, else its earliest
   * open year, else the earliest year of a sport league's current Season it has not closed. Null
   * only when none of those exists.
   */
  currentYear: number | null;
  /** Every year with a counted contest, every closed year and the current year, newest first. */
  years: ChampionshipCalendarYear[];
}

export interface ChampionshipCalendarInput {
  /** The years the league has a counted contest in. */
  contestYears: readonly number[];
  /** Its counted contests not yet final, oldest first. */
  unfinishedContests: readonly UnfinishedContest[];
  closedYears: readonly number[];
  /** The unfinished slots of the league's open years, in the sport leagues of their contests. */
  unfinishedSlots: readonly UnfinishedYearSlot[];
  /** The championship year of each sport league's current Season. */
  currentSeasonYears: readonly number[];
}

const earliest = (years: readonly number[]): number | null => (years.length === 0 ? null : Math.min(...years));

/** Where a slot falls in its Season's play: phase, competition, then the slot's own order. */
function comparePlayOrder(left: UnfinishedYearSlot, right: UnfinishedYearSlot): number {
  return compareSlotPlaces(
    { phase: left.phase, competitionOrderIndex: left.competitionOrderIndex },
    { phase: right.phase, competitionOrderIndex: right.competitionOrderIndex },
  ) || compareSeasonSlots(left, right);
}

const slotDate = (slot: UnfinishedYearSlot): number => (slot.endsAt ?? slot.startsAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;

/** Each sport league's last slot still to finish in the year, earliest date first, then by sport league name. */
function lastSlots(slots: readonly UnfinishedYearSlot[]): UnfinishedYearSlot[] {
  const lastBySportLeague = new Map<string, UnfinishedYearSlot>();
  for (const slot of slots) {
    const last = lastBySportLeague.get(slot.sportLeagueId);
    if (last === undefined || comparePlayOrder(slot, last) > 0) lastBySportLeague.set(slot.sportLeagueId, slot);
  }
  return [...lastBySportLeague.values()]
    .sort((left, right) => slotDate(left) - slotDate(right) || left.sportLeagueName.localeCompare(right.sportLeagueName));
}

export function championshipCalendar(input: ChampionshipCalendarInput): ChampionshipCalendar {
  const closed = new Set(input.closedYears);
  const openContestYears = input.contestYears.filter((year) => !closed.has(year));
  const liveYears = new Set(input.unfinishedContests.filter((contest) => contest.status === ContestStatus.ACTIVE).map((contest) => contest.championshipYear));
  const currentYear = earliest(openContestYears.filter((year) => liveYears.has(year)))
    ?? earliest(openContestYears)
    ?? earliest(input.currentSeasonYears.filter((year) => !closed.has(year)));
  const yearNumbers = [...new Set([
    ...input.contestYears,
    ...input.closedYears,
    ...(currentYear === null ? [] : [currentYear]),
  ])].sort((left, right) => right - left);
  return {
    currentYear,
    years: yearNumbers.map((championshipYear) => {
      const isClosed = closed.has(championshipYear);
      return {
        championshipYear,
        isClosed,
        closesAfter: isClosed ? [] : lastSlots(input.unfinishedSlots.filter((slot) => slot.championshipYear === championshipYear)),
        unfinishedContests: isClosed ? [] : input.unfinishedContests
          .filter((contest) => contest.championshipYear === championshipYear)
          .map((contest) => ({ id: contest.id, name: contest.name })),
      };
    }),
  };
}
