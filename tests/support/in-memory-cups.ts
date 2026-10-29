/**
 * An in-memory CupRepository (#841): cups, the contests of their seasons and sports leagues, the
 * ranked entries of those contests, their settled finishes, crowned cups' frozen standings and
 * each league's points table, held in plain arrays so a service test can build a season and read
 * it back.
 */
import type { CupContest, CupContestFinish, CupKey, CupRankedEntry, CupRepository, LeagueCupContest } from '@poolmaster/shared/db';
import {
  ContestStatus,
  CupPointsScale,
  CupStatus,
  squadContestFinishes,
  type Cup,
  type CupPointsTable,
  type CupStanding,
} from '@poolmaster/shared/domain';

/** A contest as the cup reads it, with the cup key it belongs to. */
export interface InMemoryCupContest extends CupContest, CupKey {}

export class InMemoryCups implements CupRepository {
  readonly cups: Cup[] = [];
  readonly contests: InMemoryCupContest[] = [];
  readonly rankedEntries: CupRankedEntry[] = [];
  readonly finishes: CupContestFinish[] = [];
  readonly standings: CupStanding[] = [];
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
    const cup: Cup = {
      id: `cup-${this.sequence}`,
      ...key,
      status: CupStatus.OPEN,
      crownedAt: null,
      crownedPointsTable: null,
      createdAt: new Date(Date.UTC(2026, 0, this.sequence)),
    };
    this.cups.push(cup);
    return cup;
  }

  async findById(id: string): Promise<Cup | null> {
    return this.cups.find((cup) => cup.id === id) ?? null;
  }

  async findByKey(key: CupKey): Promise<Cup | null> {
    return this.cups.find((cup) => cup.leagueId === key.leagueId && cup.seasonYear === key.seasonYear
      && cup.sportLeagueId === key.sportLeagueId) ?? null;
  }

  async findByLeagueSeason(leagueId: string, seasonYear: number): Promise<Cup[]> {
    return this.cups.filter((cup) => cup.leagueId === leagueId && cup.seasonYear === seasonYear);
  }

  async findByLeague(leagueId: string): Promise<Cup[]> {
    return this.cups.filter((cup) => cup.leagueId === leagueId);
  }

  async findSeasonYears(leagueId: string): Promise<number[]> {
    const years = this.contests
      .filter((contest) => contest.leagueId === leagueId && contest.status !== ContestStatus.DRAFT)
      .map((contest) => contest.seasonYear);
    return [...new Set(years)].sort((left, right) => right - left);
  }

  async findContests(key: CupKey): Promise<CupContest[]> {
    return (await this.findLeagueContests(key.leagueId, key.seasonYear))
      .filter((row) => row.sportLeagueId === key.sportLeagueId)
      .map((row) => row.contest);
  }

  async findLeagueContests(leagueId: string, seasonYear?: number): Promise<LeagueCupContest[]> {
    return this.contests
      .filter((contest) => contest.leagueId === leagueId && (seasonYear === undefined || contest.seasonYear === seasonYear) && contest.status !== ContestStatus.DRAFT)
      .sort((left, right) => left.firstEventStartsAt.getTime() - right.firstEventStartsAt.getTime())
      .map(({ leagueId: _leagueId, seasonYear: season, sportLeagueId, ...contest }) => ({ seasonYear: season, sportLeagueId, contest }));
  }

  async findRankedEntries(contestIds: readonly string[]): Promise<CupRankedEntry[]> {
    return this.rankedEntries.filter((entry) => contestIds.includes(entry.contestId));
  }

  /** Writes a contest's finishes as settlement does: from its ranked entries, at its weight now. */
  settle(contestId: string, recordedAt: Date): void {
    const contest = this.contests.find((candidate) => candidate.id === contestId);
    if (contest === undefined) {
      throw new Error(`No contest ${contestId}`);
    }
    const entries = this.rankedEntries.filter((entry) => entry.contestId === contestId);
    this.finishes.push(...squadContestFinishes(entries).map((finish) => ({ ...finish, contestId, weight: contest.cupWeight, recordedAt })));
  }

  async findFinishes(contestIds: readonly string[]): Promise<CupContestFinish[]> {
    return this.finishes.filter((finish) => contestIds.includes(finish.contestId));
  }

  async findStandings(cupIds: readonly string[]): Promise<CupStanding[]> {
    return this.standings.filter((standing) => cupIds.includes(standing.cupId));
  }

  async crown(cupId: string, crowning: { crownedAt: Date; pointsTable: CupPointsTable; standings: readonly CupStanding[] }): Promise<Cup | null> {
    const index = this.cups.findIndex((cup) => cup.id === cupId && cup.status === CupStatus.OPEN);
    if (index < 0) {
      return null;
    }
    const cup = this.cups[index];
    const crowned = { ...cup, status: CupStatus.CROWNED, crownedAt: crowning.crownedAt, crownedPointsTable: crowning.pointsTable };
    this.cups[index] = crowned;
    this.standings.push(...crowning.standings);
    return crowned;
  }

  async findPointsTable(leagueId: string): Promise<CupPointsTable | null> {
    return this.pointsTables.get(leagueId) ?? null;
  }
}

function sameKey(left: CupKey, right: CupKey): boolean {
  return left.leagueId === right.leagueId && left.seasonYear === right.seasonYear && left.sportLeagueId === right.sportLeagueId;
}
