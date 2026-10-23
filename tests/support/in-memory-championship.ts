/**
 * An in-memory ChampionshipRepository (#863): the league championship's finishes, each league's
 * cup name, the single-event series of contests and the unfinished contest count, held in plain
 * fields so a service test can settle contests and read a year back.
 */
import type { ChampionshipRepository } from '@poolmaster/shared/db';
import type { LeagueYearFinish } from '@poolmaster/shared/domain';

export class InMemoryChampionship implements ChampionshipRepository {
  readonly finishes: LeagueYearFinish[] = [];
  readonly cupNames = new Map<string, string>();
  readonly singleEventSeries = new Map<string, string>();
  unfinishedContests = 0;

  async recordFinishes(finishes: readonly LeagueYearFinish[]): Promise<number> {
    const fresh = finishes.filter((finish) => !this.finishes.some((kept) =>
      kept.contestId === finish.contestId && kept.squadId === finish.squadId));
    this.finishes.push(...fresh);
    return fresh.length;
  }

  async findSingleEventSeries(contestId: string): Promise<string | null> {
    return this.singleEventSeries.get(contestId) ?? null;
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
}
