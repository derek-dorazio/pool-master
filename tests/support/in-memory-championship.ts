/**
 * An in-memory ChampionshipRepository (#863): the league championship's finishes, each league's
 * cup name, the unfinished contest count, the completed
 * contests and the one-event ones with their series (#874), held in plain fields so a service test can settle contests and read a year back.
 */
import type { ChampionshipRepository, FinalContest, SeriesContest } from '@poolmaster/shared/db';
import type { LeagueYearFinish } from '@poolmaster/shared/domain';

export class InMemoryChampionship implements ChampionshipRepository {
  readonly finishes: LeagueYearFinish[] = [];
  readonly cupNames = new Map<string, string>();
  unfinishedContests = 0;
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

  async findByLeagueYear(leagueId: string, year: number): Promise<LeagueYearFinish[]> {
    return this.finishes.filter((finish) => finish.leagueId === leagueId && finish.year === year);
  }

  async findCupName(leagueId: string): Promise<string | null> {
    return this.cupNames.get(leagueId) ?? null;
  }

  async countUnfinishedContests(): Promise<number> {
    return this.unfinishedContests;
  }

  async findFinalContests(leagueId: string, from: Date, to: Date, contestIds: readonly string[]): Promise<FinalContest[]> {
    return this.finalContests
      .filter((row) => row.leagueId === leagueId && (contestIds.includes(row.contest.id)
        || (row.contest.completedAt !== null && row.contest.completedAt >= from && row.contest.completedAt < to)))
      .map((row) => row.contest);
  }

  async findSeriesContests(leagueId: string): Promise<SeriesContest[]> {
    return this.seriesContests.filter((row) => row.leagueId === leagueId).map((row) => row.contest);
  }
}
