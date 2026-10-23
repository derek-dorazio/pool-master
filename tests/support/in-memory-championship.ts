/**
 * An in-memory ChampionshipRepository (#863): the league championship's finishes, each league's
 * cup name, the single-event series of contests, the unfinished contest count and the completed
 * contests, held in plain fields so a service test can settle contests and read a year back.
 */
import type { ChampionshipRepository, FinalContest } from '@poolmaster/shared/db';
import type { LeagueYearFinish } from '@poolmaster/shared/domain';

export class InMemoryChampionship implements ChampionshipRepository {
  readonly finishes: LeagueYearFinish[] = [];
  readonly cupNames = new Map<string, string>();
  readonly singleEventSeries = new Map<string, string>();
  unfinishedContests = 0;
  readonly finalContests: Array<{ leagueId: string; contest: FinalContest }> = [];

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

  async findFinalContests(leagueId: string, from: Date, to: Date, contestIds: readonly string[]): Promise<FinalContest[]> {
    return this.finalContests
      .filter((row) => row.leagueId === leagueId && (contestIds.includes(row.contest.id)
        || (row.contest.completedAt !== null && row.contest.completedAt >= from && row.contest.completedAt < to)))
      .map((row) => row.contest);
  }
}
