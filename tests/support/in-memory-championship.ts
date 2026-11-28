/**
 * An in-memory ChampionshipRepository (#863): the league championship's finishes, each league's
 * cup name, the unfinished contest count, the completed
 * contests and the one-event ones with their series (#874), held in plain fields so a service test can settle contests and read a year back.
 */
import type { ChampionshipRepository, ClosedChampionshipYear, FinalContest, FinalContestFilter, SeriesContest } from '@poolmaster/shared/db';
import { CupWeight, type LeagueYearFinish } from '@poolmaster/shared/domain';

export class InMemoryChampionship implements ChampionshipRepository {
  readonly finishes: LeagueYearFinish[] = [];
  /** Open and live counted contests, by championship year. */
  readonly unfinishedContests = new Map<number, number>();
  /** The league's closed championship years (#2021), each closed at the start of the next calendar year. */
  readonly closedYears = new Set<number>();
  readonly finalContests: Array<{ leagueId: string; contest: FinalContest }> = [];
  readonly seriesContests: Array<{ leagueId: string; contest: SeriesContest }> = [];

  async recordFinishes(finishes: readonly LeagueYearFinish[]): Promise<number> {
    const fresh = finishes.filter((finish) => !this.finishes.some((kept) =>
      kept.contestId === finish.contestId && kept.squadId === finish.squadId));
    this.finishes.push(...fresh);
    return fresh.length;
  }

  async findByLeague(leagueId: string): Promise<LeagueYearFinish[]> {
    return this.finishes.filter((finish) => finish.leagueId === leagueId);
  }

  async findByLeagueYear(leagueId: string, year: number, settledSince?: Date): Promise<LeagueYearFinish[]> {
    return this.finishes.filter((finish) => finish.leagueId === leagueId && finish.year === year
      && (settledSince === undefined || finish.settledAt >= settledSince));
  }

  async hasCountedFinish(leagueId: string, year: number): Promise<boolean> {
    return this.finishes.some((finish) => finish.leagueId === leagueId && finish.year === year && finish.weight !== CupWeight.NOT_COUNTED);
  }

  /** The closed years, as the closed-years port answers: a test's fake holds one league's. */
  async findClosedYears(): Promise<ClosedChampionshipYear[]> {
    return [...this.closedYears].sort((left, right) => right - left)
      .map((championshipYear) => ({ championshipYear, closedAt: new Date(Date.UTC(championshipYear + 1, 0, 1)) }));
  }

  async countUnfinishedContestsByYear(): Promise<ReadonlyMap<number, number>> {
    return this.unfinishedContests;
  }

  async findFinalContests(leagueId: string, filter: FinalContestFilter): Promise<FinalContest[]> {
    return this.finalContests
      .filter((row) => row.leagueId === leagueId && ('championshipYear' in filter
        ? row.contest.championshipYear === filter.championshipYear
        : filter.contestIds.includes(row.contest.id)))
      .map((row) => row.contest);
  }

  async findSeriesContests(leagueId: string): Promise<SeriesContest[]> {
    return this.seriesContests.filter((row) => row.leagueId === leagueId).map((row) => row.contest);
  }
}
