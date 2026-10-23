/**
 * Sports league cups (#841): one season-long points race per league, season and sports league.
 * A cup is made when the league's first contest of its season and sports league is created. While
 * it is open its standings are worked out on read from its contests' settled finishes, the same
 * rows the league championship reads, so a cup never holds a number that could disagree with a
 * leaderboard. Crowning freezes them, with the points table they were scored on.
 */
import type { FastifyBaseLogger } from 'fastify';
import type {
  CupContest,
  CupContestFinish,
  CupKey,
  CupRepository,
  SportLeagueRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import {
  ContestStatus,
  CupContestCount,
  CupStatus,
  CupTrophy,
  CupWeight,
  cupFinishPoints,
  rankCupTallies,
  type Cup,
  type CupPointsTable,
  type CupStanding,
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

export class CupCrownedError extends Error {
  readonly code = 'CUP_CROWNED';

  constructor(message: string) {
    super(message);
    this.name = 'CupCrownedError';
  }
}

export class CupHasUnfinishedContestsError extends Error {
  readonly code = 'CUP_HAS_UNFINISHED_CONTESTS';

  constructor(message: string, readonly contests: readonly CupContest[]) {
    super(message);
    this.name = 'CupHasUnfinishedContestsError';
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
  /** Tenths of a point after each counted contest, in the order they went final: the race chart's line. */
  pointsAfter: number[];
  /** Its trophy from a crowned cup; null while the cup is open, and below the podium. */
  trophy: CupTrophy | null;
}

/** One contest of a cup's season and sports league, and whether it counts. */
export interface CupContestView {
  contest: CupContest;
  /** Its weight as settled once it is final, so a weight saved while it settled changes nothing; its own weight before. */
  weight: CupWeight;
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
  /** Its weight as settled. */
  weight: CupWeight;
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
  now?: () => Date;
}

/** A final contest of a cup with its settled weight and each squad's finish in it. */
interface SettledContest {
  contest: CupContest;
  weight: CupWeight;
  finishes: SquadContestFinish[];
  /** When its finishes were written; null when nobody placed. */
  recordedAt: Date | null;
}

/** What a cup's standings are worked out from: its table, every contest, and the settled ones that count. */
interface CupSeason {
  table: CupPointsTable;
  contests: CupContest[];
  settled: Map<string, SettledContest>;
  /** In the order they went final. */
  counted: SettledContest[];
}

export class CupService {
  private readonly now: () => Date;

  constructor(private readonly deps: CupServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Makes the league's cup for the season and sports league when it has none: contest creation calls it. */
  async ensureCup(key: CupKey): Promise<void> {
    const cup = await this.deps.cups.ensure(key);
    this.deps.logger?.debug({ action: 'cup.ensure', data: { ...key, cupId: cup.id } }, 'Ensured the cup a contest counts toward');
  }

  /**
   * The league's cups of one season, each with its standings and contests. A cup none of whose
   * contests is listed (its only contest was moved to another season, or is still a draft) is left out.
   */
  async listSeasonCups(leagueId: string, seasonYear: number): Promise<CupView[]> {
    const cups = await this.deps.cups.findByLeagueSeason(leagueId, seasonYear);
    const squads = await this.deps.squads.findByLeague(leagueId, true);
    const views = (await Promise.all(cups.map((cup) => this.buildCupView(cup, squads))))
      .filter((view) => view.contests.length > 0);
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
    const { table, counted } = await this.loadSeason(cup);
    const contests = counted.map(({ contest, weight, finishes }) => {
      const finish = finishes.find((candidate) => candidate.squadId === squadId) ?? null;
      return { contest, weight, finish, points: finish === null ? 0 : cupFinishPoints(table, finish, weight) };
    });
    return { cup, squad, points: contests.reduce((sum, row) => sum + row.points, 0), contests };
  }

  /**
   * Crowns a cup, the commissioner's call once its season is done: freezes every squad's place and
   * the points table they were scored on, and hands the 1st, 2nd and 3rd trophies to the squads on
   * them with points (ties share). Refused while a counted contest is still open or live, and for
   * a cup already crowned. A contest that goes final later changes nothing.
   */
  async crown(leagueId: string, cupId: string): Promise<CupView> {
    const cup = await this.requireLeagueCup(leagueId, cupId);
    if (cup.status === CupStatus.CROWNED) {
      throw this.crowned(cup);
    }
    const leagueSquads = await this.deps.squads.findByLeague(leagueId, true);
    const season = await this.loadSeason(cup);
    const unfinished = season.contests.filter((contest) => contest.status !== ContestStatus.COMPLETED && contest.cupWeight !== CupWeight.NOT_COUNTED);
    if (unfinished.length > 0) {
      this.deps.logger?.warn({ action: 'cup.crown.unfinished', data: { leagueId, cupId, contestIds: unfinished.map((contest) => contest.id) } }, 'Cup crowning refused: counted contests are not final');
      throw new CupHasUnfinishedContestsError(
        `The cup cannot be crowned while ${unfinished.map((contest) => contest.name).join(', ')} ${unfinished.length === 1 ? 'is' : 'are'} not final.`,
        unfinished,
      );
    }
    const standings = rankCupTallies(tallyCup(season.table, cupSquads(leagueSquads, season.counted), season.counted))
      .map((row): CupStanding => ({
        cupId: cup.id,
        squadId: row.squadId,
        position: row.position,
        displayPosition: row.displayPosition,
        points: row.points,
        wins: row.wins,
        podiums: row.podiums,
        contestsCounted: row.contestsCounted,
        trophy: row.points > 0 ? TROPHY_BY_POSITION.get(row.position) ?? null : null,
      }));
    const crowned = await this.deps.cups.crown(cup.id, { crownedAt: this.now(), pointsTable: season.table, standings });
    if (crowned === null) {
      throw this.crowned(cup);
    }
    this.deps.logger?.info({ action: 'cup.crown', data: { leagueId, cupId, contestsCounted: season.counted.length, squadCount: standings.length } }, 'Crowned a cup');
    return this.buildCupView(crowned, leagueSquads);
  }

  private crowned(cup: Cup): CupCrownedError {
    this.deps.logger?.warn({ action: 'cup.crown.alreadyCrowned', data: { leagueId: cup.leagueId, cupId: cup.id } }, 'Cup crowning refused: already crowned');
    return new CupCrownedError(`Cup ${cup.id} is already crowned.`);
  }

  private async requireLeagueCup(leagueId: string, cupId: string): Promise<Cup> {
    const cup = await this.deps.cups.findById(cupId);
    if (cup === null || cup.leagueId !== leagueId) {
      this.deps.logger?.warn({ action: 'cup.notFound', data: { leagueId, cupId } }, 'Cup not found in the league');
      throw new CupNotFoundError(`Cup ${cupId} was not found in this league.`);
    }
    return cup;
  }

  /**
   * The cup's contests and the final ones that count, each scored from its settled finishes and
   * weight. An open cup scores on the league's table as it stands; a crowned one on the table it
   * was crowned on, counting only contests settled before its crowning.
   */
  private async loadSeason(cup: Cup): Promise<CupSeason> {
    const [leagueTable, contests] = await Promise.all([
      this.deps.cups.findPointsTable(cup.leagueId),
      this.deps.cups.findContests(cup),
    ]);
    if (leagueTable === null) {
      throw new CupNotFoundError(`Cup ${cup.id}'s league no longer exists.`);
    }
    const finals = contests.filter((contest) => contest.status === ContestStatus.COMPLETED);
    const byContest = groupByContest(await this.deps.cups.findFinishes(finals.map((contest) => contest.id)));
    const settled = new Map(finals.map((contest): [string, SettledContest] => {
      const finishes = byContest.get(contest.id) ?? [];
      const first = finishes.at(0);
      return [contest.id, {
        contest,
        weight: first?.weight ?? contest.cupWeight,
        finishes,
        recordedAt: first?.recordedAt ?? null,
      }];
    }));
    const counted = [...settled.values()]
      .filter((row) => contestCount(cup, row.contest, row) === CupContestCount.COUNTED)
      .sort((left, right) => (left.contest.completedAt?.getTime() ?? 0) - (right.contest.completedAt?.getTime() ?? 0));
    return { table: cup.crownedPointsTable ?? leagueTable, contests, settled, counted };
  }

  private async buildCupView(cup: Cup, leagueSquads: readonly Squad[]): Promise<CupView> {
    const [{ table, contests, settled, counted }, sportLeague, frozen] = await Promise.all([
      this.loadSeason(cup),
      this.deps.sportLeagues.findById(cup.sportLeagueId),
      cup.status === CupStatus.CROWNED ? this.deps.cups.findStandings(cup.id) : Promise.resolve([]),
    ]);
    if (sportLeague === null) {
      throw new CupNotFoundError(`Cup ${cup.id}'s sports league no longer exists.`);
    }
    const squadById = new Map(leagueSquads.map((squad) => [squad.id, squad]));
    const squads = cupSquads(leagueSquads, counted);
    const pointsAfter = runningPoints(table, squads, counted);
    const countedIds = new Set(counted.map((row) => row.contest.id));

    return {
      cup,
      sportLeagueName: sportLeague.name,
      standings: cup.status === CupStatus.CROWNED
        ? frozen.flatMap((row) => {
          const squad = squadById.get(row.squadId);
          return squad === undefined ? [] : [{ ...row, squad, movement: null, pointsAfter: pointsAfter.get(row.squadId) ?? [] }];
        })
        : openStandings(table, squads, counted, pointsAfter),
      contests: contests.map((contest) => {
        const row = settled.get(contest.id);
        return {
          contest,
          weight: row?.weight ?? contest.cupWeight,
          count: contestCount(cup, contest, row),
          winners: countedIds.has(contest.id)
            ? (row?.finishes ?? []).filter((finish) => finish.place === 1).flatMap((finish) => squadById.get(finish.squadId) ?? [])
            : [],
        };
      }),
    };
  }
}

/** Places 1st to 3rd and the trophy each takes. */
const TROPHY_BY_POSITION = new Map<number, CupTrophy>([
  [1, CupTrophy.CHAMPION],
  [2, CupTrophy.RUNNER_UP],
  [3, CupTrophy.THIRD],
]);

/** The squads a cup shows: every active squad, at 0 until it places, and an inactive one once it has placed. */
function cupSquads(leagueSquads: readonly Squad[], counted: readonly SettledContest[]): Squad[] {
  const placed = new Set(counted.flatMap((row) => row.finishes.map((finish) => finish.squadId)));
  return leagueSquads
    .filter((squad) => squad.isActive || placed.has(squad.id))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** An open cup's standings, ranked now, with each squad's movement since before the latest counted contest. */
function openStandings(
  table: CupPointsTable,
  squads: readonly Squad[],
  counted: readonly SettledContest[],
  pointsAfter: ReadonlyMap<string, number[]>,
): CupStandingView[] {
  const before = counted.length >= 2 ? rankCupTallies(tallyCup(table, squads, counted.slice(0, -1))) : null;
  return rankCupTallies(tallyCup(table, squads, counted)).map((row) => {
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
      pointsAfter: pointsAfter.get(row.squadId) ?? [],
      trophy: null,
    };
  });
}

function groupByContest(finishes: readonly CupContestFinish[]): Map<string, CupContestFinish[]> {
  const grouped = new Map<string, CupContestFinish[]>();
  for (const finish of finishes) {
    grouped.set(finish.contestId, [...(grouped.get(finish.contestId) ?? []), finish]);
  }
  return grouped;
}

/**
 * Whether a contest counts toward the cup. A crowned cup counts only the contests settled before
 * its crowning: any other, final later or still to play, is AFTER_CROWNING.
 */
function contestCount(cup: Cup, contest: CupContest, settled: SettledContest | undefined): CupContestCount {
  if ((settled?.weight ?? contest.cupWeight) === CupWeight.NOT_COUNTED) {
    return CupContestCount.NOT_COUNTED;
  }
  if (cup.crownedAt !== null && !settledBefore(settled, cup.crownedAt)) {
    return CupContestCount.AFTER_CROWNING;
  }
  if (settled === undefined) {
    return CupContestCount.NOT_FINAL;
  }
  return settled.finishes.length > 0 ? CupContestCount.COUNTED : CupContestCount.NO_RESULT;
}

/** Whether a final contest was settled by the moment given; one nobody placed in goes by when it went final. */
function settledBefore(settled: SettledContest | undefined, moment: Date): boolean {
  const at = settled?.recordedAt ?? settled?.contest.completedAt ?? null;
  return at !== null && at.getTime() <= moment.getTime();
}

/** Each squad's running total after each counted contest, in the order they went final. */
function runningPoints(table: CupPointsTable, squads: readonly Squad[], counted: readonly SettledContest[]): Map<string, number[]> {
  return new Map(squads.map((squad) => {
    let total = 0;
    return [squad.id, counted.map(({ weight, finishes }) => {
      const finish = finishes.find((candidate) => candidate.squadId === squad.id);
      total += finish === undefined ? 0 : cupFinishPoints(table, finish, weight);
      return total;
    })];
  }));
}

/** Each squad's points, wins, podiums and counted contests over the contests given. */
function tallyCup(table: CupPointsTable, squads: readonly Squad[], counted: readonly SettledContest[]) {
  return squads.map((squad) => {
    const finishes = counted.flatMap(({ weight, finishes: all }) => {
      const finish = all.find((candidate) => candidate.squadId === squad.id);
      return finish === undefined ? [] : [{ finish, points: cupFinishPoints(table, finish, weight) }];
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
