import type {
  ContestStatus,
  Cup,
  CupPointsTable,
  CupStanding,
  CupWeight,
  RankedContestEntry,
  SelectionType,
  SquadContestFinish,
} from '../domain';

/** Which cup: one per league, season and sports league (#841). */
export type CupKey = Pick<Cup, 'leagueId' | 'seasonYear' | 'sportLeagueId'>;

/** One of the league's contests in a cup's season and sports league, as the cup reads it. */
export interface CupContest {
  id: string;
  name: string;
  status: ContestStatus;
  selectionType: SelectionType;
  cupWeight: CupWeight;
  /** When its first event starts. */
  firstEventStartsAt: Date;
  /** When it went COMPLETED; null before. */
  completedAt: Date | null;
}

/** One of the league's contests, with the cup it counts toward. */
export interface LeagueCupContest {
  seasonYear: number;
  sportLeagueId: string;
  contest: CupContest;
}

/** One entry with a frozen place in a settled contest. */
export interface CupRankedEntry extends RankedContestEntry {
  contestId: string;
}

/**
 * One squad's finish in a settled contest as the cup scores it: the championship's row for it
 * (#863), written once at settlement, so the cup and the championship read the same weight.
 */
export interface CupContestFinish extends SquadContestFinish {
  contestId: string;
  /** The contest's weight when it was settled. */
  weight: CupWeight;
  /** When settlement wrote it: a crowned cup counts only finishes written before its crowning. */
  recordedAt: Date;
}

/** The cups a league has, and what their standings are worked out from (#841). */
export interface CupRepository {
  /** The league's cup for the season and sports league, made when it has none: a cup is never set up by hand. */
  ensure(key: CupKey): Promise<Cup>;
  findById(id: string): Promise<Cup | null>;
  /** The league's cup for the season and sports league, or null when it has none (#1202). */
  findByKey(key: CupKey): Promise<Cup | null>;
  /** The league's cups of one season, oldest first. */
  findByLeagueSeason(leagueId: string, seasonYear: number): Promise<Cup[]>;
  /** Every cup of the league, of every season, oldest first. */
  findByLeague(leagueId: string): Promise<Cup[]>;
  /** The seasons in which the league has a contest a cup lists (drafts left out), newest first. */
  findSeasonYears(leagueId: string): Promise<number[]>;
  /** The league's contests of the cup's season and sports league, drafts left out, by first event start. */
  findContests(key: CupKey): Promise<CupContest[]>;
  /**
   * The league's contests of every cup, or of one season's, drafts left out, by first event
   * start: what `findContests` reads for each cup, in one read.
   */
  findLeagueContests(leagueId: string, seasonYear?: number): Promise<LeagueCupContest[]>;
  /** Every entry with a frozen place in the contests. */
  findRankedEntries(contestIds: readonly string[]): Promise<CupRankedEntry[]>;
  /** Each squad's settled finish in the contests, from its best entry. */
  findFinishes(contestIds: readonly string[]): Promise<CupContestFinish[]>;
  /** The crowned cups' frozen standings, by cup and position; none for an open one. */
  findStandings(cupIds: readonly string[]): Promise<CupStanding[]>;
  /**
   * Crowns an OPEN cup: freezes its standings and the points table they were scored on. Answers
   * the crowned cup, or null when it was already crowned, so two crownings never both write.
   */
  crown(cupId: string, crowning: { crownedAt: Date; pointsTable: CupPointsTable; standings: readonly CupStanding[] }): Promise<Cup | null>;
}
