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
}

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
  /** The league's open and live contests that will count once final. */
  countUnfinishedContests(leagueId: string): Promise<number>;
  /**
   * The league's completed contests that went final from `from` until `to`, and those named in
   * `contestIds` whenever they did (#837).
   */
  findFinalContests(leagueId: string, from: Date, to: Date, contestIds: readonly string[]): Promise<FinalContest[]>;
  /** The league's completed contests of exactly one event, with the slot definitions it covers (#874, #2010). */
  findSeriesContests(leagueId: string): Promise<SeriesContest[]>;
}

/** Whether a league's year in review was sent (#872 slice 4). */
export interface LeagueYearReviewRepository {
  findByLeagueYear(leagueId: string, championshipYear: number): Promise<LeagueYearReview | null>;
  /** Records the send; null when one is already recorded for the league and year. */
  create(review: Omit<LeagueYearReview, 'sentAt'>): Promise<LeagueYearReview | null>;
}
