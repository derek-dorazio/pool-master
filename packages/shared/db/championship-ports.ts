import type { LeagueYearFinish } from '../domain';

/** The league championship's finishes, written at settlement and read by year (#863). */
export interface ChampionshipRepository {
  /** Writes a settled contest's finishes; one already written for its contest and squad is kept. Answers how many it wrote. */
  recordFinishes(finishes: readonly LeagueYearFinish[]): Promise<number>;
  /** The series of a contest of one event (the Masters); null for a contest of several events. */
  findSingleEventSeries(contestId: string): Promise<string | null>;
  /** Every finish of the league, of every year. */
  findByLeague(leagueId: string): Promise<LeagueYearFinish[]>;
  /** The league's finishes of one year. */
  findByLeagueYear(leagueId: string, year: number): Promise<LeagueYearFinish[]>;
  /** The league championship's name, or null when there is no such league. */
  findCupName(leagueId: string): Promise<string | null>;
  /** The league's open and live contests that will count once final. */
  countUnfinishedContests(leagueId: string): Promise<number>;
}
