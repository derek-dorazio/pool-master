/**
 * An in-memory CupRepository (#841): cups, the contests of their seasons and sports leagues, the
 * ranked entries of those contests and each league's points table, held in plain arrays so a
 * service test can build a season and read it back.
 */
import type { CupContest, CupKey, CupRankedEntry, CupRepository } from '@poolmaster/shared/db';
import { ContestStatus, CupPointsScale, type Cup, type CupPointsTable } from '@poolmaster/shared/domain';

/** A contest as the cup reads it, with the cup key it belongs to. */
export interface InMemoryCupContest extends CupContest, CupKey {}

export class InMemoryCups implements CupRepository {
  readonly cups: Cup[] = [];
  readonly contests: InMemoryCupContest[] = [];
  readonly rankedEntries: CupRankedEntry[] = [];
  readonly pointsTables = new Map<string, CupPointsTable>();
  private sequence = 0;

  /** A league the repository knows, on the STANDARD table unless told otherwise. */
  addLeague(leagueId: string, table: CupPointsTable = { scale: CupPointsScale.STANDARD, customPoints: [] }): void {
    this.pointsTables.set(leagueId, table);
  }

  async ensure(key: CupKey): Promise<Cup> {
    const existing = this.cups.find((cup) => sameKey(cup, key));
    if (existing) {
      return existing;
    }
    this.sequence += 1;
    const cup = { id: `cup-${this.sequence}`, ...key, createdAt: new Date(Date.UTC(2026, 0, this.sequence)) };
    this.cups.push(cup);
    return cup;
  }

  async findById(id: string): Promise<Cup | null> {
    return this.cups.find((cup) => cup.id === id) ?? null;
  }

  async findByLeagueSeason(leagueId: string, seasonYear: number): Promise<Cup[]> {
    return this.cups.filter((cup) => cup.leagueId === leagueId && cup.seasonYear === seasonYear);
  }

  async findContests(key: CupKey): Promise<CupContest[]> {
    return this.contests
      .filter((contest) => sameKey(contest, key) && contest.status !== ContestStatus.DRAFT)
      .sort((left, right) => left.firstEventStartsAt.getTime() - right.firstEventStartsAt.getTime());
  }

  async findRankedEntries(contestIds: readonly string[]): Promise<CupRankedEntry[]> {
    return this.rankedEntries.filter((entry) => contestIds.includes(entry.contestId));
  }

  async findPointsTable(leagueId: string): Promise<CupPointsTable | null> {
    return this.pointsTables.get(leagueId) ?? null;
  }
}

function sameKey(left: CupKey, right: CupKey): boolean {
  return left.leagueId === right.leagueId && left.seasonYear === right.seasonYear && left.sportLeagueId === right.sportLeagueId;
}
