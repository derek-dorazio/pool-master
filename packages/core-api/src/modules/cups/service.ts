/**
 * Sports league cups (#841): one season-long points race per league, season and sports league.
 * A cup is made when the league's first contest of its season and sports league is created, and
 * its standings are worked out on read from its contests' frozen places, so a cup never holds a
 * number that could disagree with a leaderboard.
 */
import type { FastifyBaseLogger } from 'fastify';
import type {
  CupContest,
  CupKey,
  CupRankedEntry,
  CupRepository,
  SportLeagueRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import {
  ContestStatus,
  CupContestCount,
  CupWeight,
  cupFinishPoints,
  rankCupTallies,
  squadContestFinishes,
  type Cup,
  type CupPointsTable,
  type Squad,
  type SquadContestFinish,
} from '@poolmaster/shared/domain';

type CupLogger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn'>;

export class CupNotFoundError extends Error {
  readonly code = 'CUP_NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'CupNotFoundError';
  }
}

export class CupSquadNotFoundError extends Error {
  readonly code = 'SQUAD_NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'CupSquadNotFoundError';
  }
}

/** One squad's place in a cup. */
export interface CupStandingView {
  squad: Squad;
  position: number;
  displayPosition: string;
  /** Tenths of a point. */
  points: number;
  wins: number;
  podiums: number;
  /** Counted contests the squad placed in. */
  contestsCounted: number;
  /** Places gained (positive) or lost since before the latest counted contest; null until two have counted. */
  movement: number | null;
}

/** One contest of a cup's season and sports league, and whether it counts. */
export interface CupContestView {
  contest: CupContest;
  count: CupContestCount;
  /** The squads that won it, several on a tie; empty unless it counted. */
  winners: Squad[];
}

export interface CupView {
  cup: Cup;
  sportLeagueName: string;
  standings: CupStandingView[];
  contests: CupContestView[];
}

/** One counted contest in a squad's cup breakdown. */
export interface CupSquadContestView {
  contest: CupContest;
  /** The squad's best entry's finish, or null when it had no ranked entry. */
  finish: SquadContestFinish | null;
  /** Tenths of a point. */
  points: number;
}

export interface CupSquadPointsView {
  cup: Cup;
  squad: Squad;
  /** Tenths of a point. */
  points: number;
  contests: CupSquadContestView[];
}

export interface CupServiceDeps {
  cups: CupRepository;
  squads: SquadRepository;
  sportLeagues: SportLeagueRepository;
  logger?: CupLogger;
}

/** The counted contests of a cup with each squad's finish in them. */
interface CountedContest {
  contest: CupContest;
  finishes: SquadContestFinish[];
}

export class CupService {
  constructor(private readonly deps: CupServiceDeps) {}

  /** Makes the league's cup for the season and sports league when it has none: contest creation calls it. */
  async ensureCup(key: CupKey): Promise<void> {
    const cup = await this.deps.cups.ensure(key);
    this.deps.logger?.debug({ action: 'cup.ensure', data: { ...key, cupId: cup.id } }, 'Ensured the cup a contest counts toward');
  }

  /** The league's cups of one season, each with its standings and contests. */
  async listSeasonCups(leagueId: string, seasonYear: number): Promise<CupView[]> {
    const cups = await this.deps.cups.findByLeagueSeason(leagueId, seasonYear);
    const squads = await this.deps.squads.findByLeague(leagueId, true);
    const views = await Promise.all(cups.map((cup) => this.buildCupView(cup, squads)));
    this.deps.logger?.debug({ action: 'cup.list', data: { leagueId, seasonYear, cupCount: views.length } }, 'Listed a season\'s cups');
    return views;
  }

  async getCup(leagueId: string, cupId: string): Promise<CupView> {
    const cup = await this.requireLeagueCup(leagueId, cupId);
    return this.buildCupView(cup, await this.deps.squads.findByLeague(leagueId, true));
  }

  /** One squad's points in a cup, counted contest by counted contest. */
  async getSquadPoints(leagueId: string, cupId: string, squadId: string): Promise<CupSquadPointsView> {
    const cup = await this.requireLeagueCup(leagueId, cupId);
    const squad = await this.deps.squads.findById(squadId);
    if (squad === null || squad.leagueId !== leagueId) {
      this.deps.logger?.warn({ action: 'cup.squadPoints.squadNotFound', data: { leagueId, cupId, squadId } }, 'Cup squad points asked for a squad outside the league');
      throw new CupSquadNotFoundError(`Squad ${squadId} is not in this league.`);
    }
    const { table, counted } = await this.loadCountedContests(cup);
    const contests = counted.map(({ contest, finishes }) => {
      const finish = finishes.find((candidate) => candidate.squadId === squadId) ?? null;
      return { contest, finish, points: finish === null ? 0 : cupFinishPoints(table, finish, contest.cupWeight) };
    });
    return { cup, squad, points: contests.reduce((sum, row) => sum + row.points, 0), contests };
  }

  private async requireLeagueCup(leagueId: string, cupId: string): Promise<Cup> {
    const cup = await this.deps.cups.findById(cupId);
    if (cup === null || cup.leagueId !== leagueId) {
      this.deps.logger?.warn({ action: 'cup.notFound', data: { leagueId, cupId } }, 'Cup not found in the league');
      throw new CupNotFoundError(`Cup ${cupId} was not found in this league.`);
    }
    return cup;
  }

  private async loadCountedContests(cup: Cup): Promise<{ table: CupPointsTable; contests: CupContest[]; counted: CountedContest[] }> {
    const [table, contests] = await Promise.all([
      this.deps.cups.findPointsTable(cup.leagueId),
      this.deps.cups.findContests(cup),
    ]);
    if (table === null) {
      throw new CupNotFoundError(`Cup ${cup.id}'s league no longer exists.`);
    }
    const finals = contests.filter((contest) => contest.status === ContestStatus.COMPLETED && contest.cupWeight !== CupWeight.NOT_COUNTED);
    const entries = await this.deps.cups.findRankedEntries(finals.map((contest) => contest.id));
    const byContest = groupByContest(entries);
    const counted = finals
      .map((contest) => ({ contest, finishes: squadContestFinishes(byContest.get(contest.id) ?? []) }))
      .filter((row) => row.finishes.length > 0)
      .sort((left, right) => (left.contest.completedAt?.getTime() ?? 0) - (right.contest.completedAt?.getTime() ?? 0));
    return { table, contests, counted };
  }

  private async buildCupView(cup: Cup, leagueSquads: readonly Squad[]): Promise<CupView> {
    const [{ table, contests, counted }, sportLeague] = await Promise.all([
      this.loadCountedContests(cup),
      this.deps.sportLeagues.findById(cup.sportLeagueId),
    ]);
    if (sportLeague === null) {
      throw new CupNotFoundError(`Cup ${cup.id}'s sports league no longer exists.`);
    }
    const placed = new Set(counted.flatMap((row) => row.finishes.map((finish) => finish.squadId)));
    // Every active squad shows, at 0 until it places; an inactive one shows once it has placed.
    const squads = leagueSquads
      .filter((squad) => squad.isActive || placed.has(squad.id))
      .sort((left, right) => left.name.localeCompare(right.name));
    const now = rankCupTallies(tallyCup(table, squads, counted));
    const before = counted.length >= 2 ? rankCupTallies(tallyCup(table, squads, counted.slice(0, -1))) : null;
    const squadById = new Map(leagueSquads.map((squad) => [squad.id, squad]));
    const countedIds = new Map(counted.map((row) => [row.contest.id, row]));

    return {
      cup,
      sportLeagueName: sportLeague.name,
      standings: now.map((row) => {
        const previous = before?.find((candidate) => candidate.squadId === row.squadId);
        return {
          squad: row.squad,
          position: row.position,
          displayPosition: row.displayPosition,
          points: row.points,
          wins: row.wins,
          podiums: row.podiums,
          contestsCounted: row.contestsCounted,
          movement: previous === undefined ? null : previous.position - row.position,
        };
      }),
      contests: contests.map((contest) => {
        const row = countedIds.get(contest.id);
        return {
          contest,
          count: contestCount(contest, row !== undefined),
          winners: (row?.finishes ?? [])
            .filter((finish) => finish.place === 1)
            .flatMap((finish) => squadById.get(finish.squadId) ?? []),
        };
      }),
    };
  }
}

function groupByContest(entries: readonly CupRankedEntry[]): Map<string, CupRankedEntry[]> {
  const grouped = new Map<string, CupRankedEntry[]>();
  for (const entry of entries) {
    grouped.set(entry.contestId, [...(grouped.get(entry.contestId) ?? []), entry]);
  }
  return grouped;
}

function contestCount(contest: CupContest, placed: boolean): CupContestCount {
  if (contest.cupWeight === CupWeight.NOT_COUNTED) {
    return CupContestCount.NOT_COUNTED;
  }
  if (contest.status !== ContestStatus.COMPLETED) {
    return CupContestCount.NOT_FINAL;
  }
  return placed ? CupContestCount.COUNTED : CupContestCount.NO_RESULT;
}

/** Each squad's points, wins, podiums and counted contests over the contests given. */
function tallyCup(table: CupPointsTable, squads: readonly Squad[], counted: readonly CountedContest[]) {
  return squads.map((squad) => {
    const finishes = counted.flatMap(({ contest, finishes: all }) => {
      const finish = all.find((candidate) => candidate.squadId === squad.id);
      return finish === undefined ? [] : [{ finish, points: cupFinishPoints(table, finish, contest.cupWeight) }];
    });
    return {
      squadId: squad.id,
      squad,
      points: finishes.reduce((sum, row) => sum + row.points, 0),
      wins: finishes.filter((row) => row.finish.place === 1).length,
      podiums: finishes.filter((row) => row.finish.place <= 3).length,
      contestsCounted: finishes.length,
    };
  });
}
