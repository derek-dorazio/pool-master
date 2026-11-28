import type { CupWeight, LeagueYearFinish, LeagueYearReview, SelectionType } from '../domain';

/** A contest that went final, as a year's contest list names it (#837). */
export interface FinalContest {
  id: string;
  name: string;
  selectionType: SelectionType;
  /** The sports league its events are in, such as "PGA Tour". */
  sportLeagueName: string;
  /** When it went final; null for a contest completed before the time was kept. */
  completedAt: Date | null;
  /** The championship year it counts in (#2021), whenever it went final. */
  championshipYear: number;
}

/** Which final contests to read (#2021): one championship year's, or those named. */
/**
 * Which final contests to read: a championship year's, optionally only those that went final at
 * or after `finishedSince` (League Home's recent finals), or the listed contests.
 */
export type FinalContestFilter = { championshipYear: number; finishedSince?: Date } | { contestIds: readonly string[] };

/**
 * A final contest of exactly one event (#874): what a perpetual trophy is built from. Until #2024
 * a trophy is keyed by the slot definitions the event covers (#2010): each Season has a slot of
 * each, so the same definitions and selection type again is the same contest run again.
 */
export interface SeriesContest {
  id: string;
  selectionType: SelectionType;
  cupWeight: CupWeight;
  /** The slot definitions of the event's Season slots, in play order; empty for an event with none. */
  slotDefinitionIds: string[];
  /** The event's name, such as "Masters Tournament 2026". */
  eventName: string;
  /** The league's proper name for the first of those definitions, such as "Masters"; null when it has none. */
  slotName: string | null;
  sportLeagueName: string;
  /** The year the edition's Season is named for: the 2026 Masters. */
  championshipYear: number;
  /** When it went final; null for a contest completed before the time was kept. */
  completedAt: Date | null;
  /** The event's games, counted: how many, over how many rounds, and how many send their winner on. */
  games: { count: number; roundCount: number; sendingWinnerOn: number };
}

/** The league championship's finishes, written at settlement and read by year (#863). */
export interface ChampionshipRepository {
  /** Writes a settled contest's finishes; one already written for its contest and squad is kept. Answers how many it wrote. */
  recordFinishes(finishes: readonly LeagueYearFinish[]): Promise<number>;
  /** Every finish of the league, of every year. */
  findByLeague(leagueId: string): Promise<LeagueYearFinish[]>;
  /** The league's finishes of one year; with `settledSince`, only those settled at or after it (#1782). */
  findByLeagueYear(leagueId: string, year: number, settledSince?: Date): Promise<LeagueYearFinish[]>;
  /** Whether the league has a counted finish in the year. */
  hasCountedFinish(leagueId: string, year: number): Promise<boolean>;
  /** The league's open and live contests that will count once final, by their championship year (#2021). */
  countUnfinishedContestsByYear(leagueId: string): Promise<ReadonlyMap<number, number>>;
  /** The league's completed contests of one championship year, or those named (#837, #2021). */
  findFinalContests(leagueId: string, filter: FinalContestFilter): Promise<FinalContest[]>;
  /** The league's completed contests of exactly one event, with the slot definitions it covers (#874, #2010). */
  findSeriesContests(leagueId: string): Promise<SeriesContest[]>;
}

/** Whether a league's year in review was sent (#872 slice 4). */
export interface LeagueYearReviewRepository {
  findByLeagueYear(leagueId: string, championshipYear: number): Promise<LeagueYearReview | null>;
  /** Records the send; null when one is already recorded for the league and year. */
  create(review: Omit<LeagueYearReview, 'sentAt'>): Promise<LeagueYearReview | null>;
}

/** A league's closed championship year (#2021): closed once, never reopened. */
export interface ClosedChampionshipYear {
  championshipYear: number;
  closedAt: Date;
}

/** What still holds a league's championship year open (#2021), as the year close reads it. */
export interface ChampionshipYearState {
  /** The league's contests in the year, drafts that can never open aside. */
  contestCount: number;
  /** Of those, the ones not yet final. */
  unfinishedContestCount: number;
  /**
   * The year's Season slots still to finish, in the sport leagues of those contests: a test slot
   * only when one of those contests covers it, since a Season's real slots are what end it.
   */
  unfinishedSeasonSlotCount: number;
}

/** A league and one of its championship years. */
export interface LeagueChampionshipYearKey {
  leagueId: string;
  championshipYear: number;
}

/** A league's closed championship years (#2021): read by the year close, history and Create contest. */
export interface LeagueChampionshipYearRepository {
  findClosedYears(leagueId: string): Promise<ClosedChampionshipYear[]>;
  isClosed(key: LeagueChampionshipYearKey): Promise<boolean>;
  readYearState(key: LeagueChampionshipYearKey, now: Date): Promise<ChampionshipYearState>;
  /** Closes the year; false when it was already closed, which a close never undoes. */
  close(key: LeagueChampionshipYearKey, closedAt: Date): Promise<boolean>;
  /** The league and championship year of a contest; null when it is gone. */
  findContestYear(contestId: string): Promise<LeagueChampionshipYearKey | null>;
  /** Each league with a contest in the Season slot's Season, with that Season's year. */
  findLeagueYearsOfSeasonSlot(seasonSlotId: string): Promise<LeagueChampionshipYearKey[]>;
}
