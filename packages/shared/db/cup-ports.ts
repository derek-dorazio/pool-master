import type {
  ContestStatus,
  Cup,
  CupPointsTable,
  CupWeight,
  RankedContestEntry,
  SelectionType,
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

/** One entry with a frozen place in a settled contest. */
export interface CupRankedEntry extends RankedContestEntry {
  contestId: string;
}

/** The cups a league has, and what their standings are worked out from (#841). */
export interface CupRepository {
  /** The league's cup for the season and sports league, made when it has none: a cup is never set up by hand. */
  ensure(key: CupKey): Promise<Cup>;
  findById(id: string): Promise<Cup | null>;
  /** The league's cups of one season, oldest first. */
  findByLeagueSeason(leagueId: string, seasonYear: number): Promise<Cup[]>;
  /** The league's contests of the cup's season and sports league, drafts left out, by first event start. */
  findContests(key: CupKey): Promise<CupContest[]>;
  /** Every entry with a frozen place in the contests. */
  findRankedEntries(contestIds: readonly string[]): Promise<CupRankedEntry[]>;
  /** The league's points table, or null when there is no such league. */
  findPointsTable(leagueId: string): Promise<CupPointsTable | null>;
}
