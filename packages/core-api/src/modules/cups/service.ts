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
  LeagueCupContest,
  LeagueRepository,
  SportLeagueRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import {
  ContestStatus,
  CupContestCount,
  CupStatus,
  type CupTrophy,
  CupWeight,
  cupFinishPoints,
  leaguePointsTable,
  rankCupTallies,
  type Cup,
  type CupPointsTable,
  type CupStanding,
  type RankedContestEntry,
  type Squad,
  type SquadContestFinish,
  squadContestFinishes,
  trophyForPlace,
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

export class CupNothingCountedError extends Error {
  readonly code = 'CUP_NOTHING_COUNTED';

  constructor(message: string) {
    super(message);
    this.name = 'CupNothingCountedError';
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

/** One season's cups. */
export interface CupSeasonView {
  seasonYear: number;
  cups: CupView[];
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
  sportLeagueName: string;
  squad: Squad;
  /** Tenths of a point. */
  points: number;
  contests: CupSquadContestView[];
}

/** One squad's place in a cup if its live contests ended now. */
export interface CupProjectedStandingView {
  squad: Squad;
  position: number;
  displayPosition: string;
  /** Tenths of a point, the live contests' included. */
  points: number;
  /** Tenths of a point the live contests would add. */
  gained: number;
  /** Places gained (positive) or lost against the standings as they are. */
  movement: number;
}

/** A cup's standings if every live contest it counts ended now. */
export interface CupProjectionView {
  cup: Cup;
  /** The live contests the projection counts, each at its own weight. */
  contests: CupContest[];
  standings: CupProjectedStandingView[];
}

/** A live contest's places as they stand, by entry: the contest's own leaderboard. */
export interface CupLivePositions {
  livePositionsOf(contestId: string): Promise<RankedContestEntry[]>;
}

export interface CupServiceDeps {
  cups: CupRepository;
  /** The league's points table comes from its row, read once per request (#1176). */
  leagues: Pick<LeagueRepository, 'findById'>;
  liveContests: CupLivePositions;
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
    const [cups, squads, contests] = await Promise.all([
      this.deps.cups.findByLeagueSeason(leagueId, seasonYear),
      this.deps.squads.findByLeague(leagueId, true),
      this.deps.cups.findLeagueContests(leagueId, seasonYear),
    ]);
    const listed = listedCups(cups, contests);
    const views = await this.buildCupViews(listed.cups, squads, listed.contestsOf);
    this.deps.logger?.debug({ action: 'cup.list', data: { leagueId, seasonYear, cupCount: views.length } }, 'Listed a season\'s cups');
    return views;
  }

  /**
   * Every season the league has a cup to show in, newest first, each with its cups as
   * `listSeasonCups` lists them, from one read of the league's cups, contests and finishes: the
   * All years summary and a squad's history read every season at once.
   */
  async listLeagueSeasons(leagueId: string): Promise<CupSeasonView[]> {
    const [cups, squads, contests] = await Promise.all([
      this.deps.cups.findByLeague(leagueId),
      this.deps.squads.findByLeague(leagueId, true),
      this.deps.cups.findLeagueContests(leagueId),
    ]);
    const listed = listedCups(cups, contests);
    const views = await this.buildCupViews(listed.cups, squads, listed.contestsOf);
    // The seasons of the listed contests, as `listSeasonYears` reads them.
    const seasons = [...new Set(contests.map((row) => row.seasonYear))].sort((left, right) => right - left);
    this.deps.logger?.debug({ action: 'cup.listLeague', data: { leagueId, seasonCount: seasons.length, cupCount: views.length } }, 'Listed every season\'s cups');
    return seasons.map((seasonYear) => ({ seasonYear, cups: views.filter((view) => view.cup.seasonYear === seasonYear) }));
  }

  /** The seasons the league has a cup to show in, newest first: the Championships year picker's cup years. */
  async listSeasonYears(leagueId: string): Promise<number[]> {
    return this.deps.cups.findSeasonYears(leagueId);
  }

  async getCup(leagueId: string, cupId: string): Promise<CupView> {
    const cup = await this.requireLeagueCup(leagueId, cupId);
    const [squads, contests] = await Promise.all([this.deps.squads.findByLeague(leagueId, true), this.deps.cups.findContests(cup)]);
    return this.buildCupView(cup, squads, contests);
  }

  /**
   * One squad's points in the league's cup for a season and sports league, counted contest by
   * counted contest. The page names the cup by its season and sports league, so this finds it by
   * them rather than the page reading every cup of the season for its id (#1202).
   */
  async getSquadPoints(key: CupKey, squadId: string): Promise<CupSquadPointsView> {
    const { leagueId } = key;
    const [cup, squad, sportLeague] = await Promise.all([
      this.deps.cups.findByKey(key),
      this.deps.squads.findById(squadId),
      this.deps.sportLeagues.findById(key.sportLeagueId),
    ]);
    if (cup === null || sportLeague === null) {
      this.deps.logger?.warn({ action: 'cup.squadPoints.cupNotFound', data: { ...key, squadId } }, 'Cup squad points asked for a cup the league does not have');
      throw new CupNotFoundError(`The league has no ${String(key.seasonYear)} cup for sports league ${key.sportLeagueId}.`);
    }
    if (squad === null || squad.leagueId !== leagueId) {
      this.deps.logger?.warn({ action: 'cup.squadPoints.squadNotFound', data: { leagueId, cupId: cup.id, squadId } }, 'Cup squad points asked for a squad outside the league');
      throw new CupSquadNotFoundError(`Squad ${squadId} is not in this league.`);
    }
    const { table, counted } = await this.loadSeason(cup);
    const contests = counted.map(({ contest, weight, finishes }) => {
      const finish = finishes.find((candidate) => candidate.squadId === squadId) ?? null;
      return { contest, weight, finish, points: finish === null ? 0 : cupFinishPoints(table, finish, weight) };
    });
    return { cup, sportLeagueName: sportLeague.name, squad, points: contests.reduce((sum, row) => sum + row.points, 0), contests };
  }

  /**
   * An open cup's standings if every live contest it counts ended now: each live contest scores
   * from its leaderboard's places as they stand, at its own weight, on top of the contests already
   * counted. Nothing is stored; the page greys it as "if it ended now". A crowned cup's standings
   * are frozen, so it has no projection.
   */
  async getProjection(leagueId: string, cupId: string): Promise<CupProjectionView> {
    const cup = await this.requireLeagueCup(leagueId, cupId);
    if (cup.status === CupStatus.CROWNED) {
      this.deps.logger?.warn({ action: 'cup.projection.crowned', data: { leagueId, cupId } }, 'Cup projection refused: the cup is crowned');
      throw new CupCrownedError(`Cup ${cup.id} is crowned, so its standings are final.`);
    }
    const [leagueSquads, season] = await Promise.all([this.deps.squads.findByLeague(leagueId, true), this.loadSeason(cup)]);
    const live = season.contests.filter((contest) => contest.status === ContestStatus.ACTIVE && contest.cupWeight !== CupWeight.NOT_COUNTED);
    const projected = await Promise.all(live.map(async (contest): Promise<SettledContest> => ({
      contest,
      weight: contest.cupWeight,
      finishes: squadContestFinishes(await this.deps.liveContests.livePositionsOf(contest.id)),
      recordedAt: null,
    })));
    const all = [...season.counted, ...projected];
    const squads = cupSquads(leagueSquads, all);
    const standingNow = new Map(rankCupTallies(tallyCup(season.table, squads, season.counted)).map((row) => [row.squadId, row]));
    const standings = rankCupTallies(tallyCup(season.table, squads, all)).map((row) => {
      const current = standingNow.get(row.squadId);
      return {
        squad: row.squad,
        position: row.position,
        displayPosition: row.displayPosition,
        points: row.points,
        gained: row.points - (current?.points ?? 0),
        movement: (current?.position ?? row.position) - row.position,
      };
    });
    this.deps.logger?.debug({ action: 'cup.projection', data: { leagueId, cupId, liveContestCount: live.length } }, 'Projected a cup from its live contests');
    return { cup, contests: live, standings };
  }

  /**
   * Crowns a cup, the commissioner's call once its season is done: freezes every squad's place and
   * the points table they were scored on, and hands the 1st, 2nd and 3rd trophies to the squads on
   * them with points (ties share). Refused while a counted contest is still open or live, before
   * any contest has counted, and for a cup already crowned. A contest that goes final later changes nothing.
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
    if (season.counted.length === 0) {
      this.deps.logger?.warn({ action: 'cup.crown.nothingCounted', data: { leagueId, cupId } }, 'Cup crowning refused: no contest has counted');
      throw new CupNothingCountedError('The cup cannot be crowned before a contest has counted toward it.');
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
        trophy: trophyForPlace(row.position, row.points),
      }));
    const crowned = await this.deps.cups.crown(cup.id, { crownedAt: this.now(), pointsTable: season.table, standings });
    if (crowned === null) {
      throw this.crowned(cup);
    }
    this.deps.logger?.info({ action: 'cup.crown', data: { leagueId, cupId, contestsCounted: season.counted.length, squadCount: standings.length } }, 'Crowned a cup');
    return this.buildCupView(crowned, leagueSquads, season.contests);
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
    const [league, contests] = await Promise.all([
      this.deps.leagues.findById(cup.leagueId),
      this.deps.cups.findContests(cup),
    ]);
    if (league === null) {
      throw new CupNotFoundError(`Cup ${cup.id}'s league no longer exists.`);
    }
    const finishes = await this.deps.cups.findFinishes(finalContestIds(contests));
    return seasonOf(cup, leaguePointsTable(league), contests, groupByContest(finishes));
  }

  private async buildCupView(cup: Cup, leagueSquads: readonly Squad[], contests: readonly CupContest[]): Promise<CupView> {
    const [view] = await this.buildCupViews([cup], leagueSquads, new Map([[cup.id, contests]]));
    return view;
  }

  /**
   * The cups' views with their standings and contests. However many cups, it reads the league's
   * points table, the cups' sports leagues, their final contests' finishes and the crowned ones'
   * frozen standings once each.
   */
  private async buildCupViews(listed: readonly Cup[], leagueSquads: readonly Squad[], contestsOf: ReadonlyMap<string, readonly CupContest[]>): Promise<CupView[]> {
    const first = listed.at(0);
    if (first === undefined) {
      return [];
    }
    const contestIds = listed.flatMap((cup) => finalContestIds(contestsOf.get(cup.id) ?? []));
    const crownedIds = listed.filter((cup) => cup.status === CupStatus.CROWNED).map((cup) => cup.id);
    const [league, sportLeagues, finishes, frozen] = await Promise.all([
      this.deps.leagues.findById(first.leagueId),
      this.deps.sportLeagues.findByIds([...new Set(listed.map((cup) => cup.sportLeagueId))]),
      this.deps.cups.findFinishes(contestIds),
      this.deps.cups.findStandings(crownedIds),
    ]);
    if (league === null) {
      throw new CupNotFoundError(`Cup ${first.id}'s league no longer exists.`);
    }
    const leagueTable = leaguePointsTable(league);
    const byContest = groupByContest(finishes);
    const sportLeagueNames = new Map(sportLeagues.map((sportLeague) => [sportLeague.id, sportLeague.name]));
    const frozenByCup = new Map<string, CupStanding[]>();
    for (const row of frozen) {
      const rows = frozenByCup.get(row.cupId);
      if (rows === undefined) frozenByCup.set(row.cupId, [row]);
      else rows.push(row);
    }
    const squadById = new Map(leagueSquads.map((squad) => [squad.id, squad]));

    return listed.map((cup): CupView => {
      const sportLeagueName = sportLeagueNames.get(cup.sportLeagueId);
      if (sportLeagueName === undefined) {
        throw new CupNotFoundError(`Cup ${cup.id}'s sports league no longer exists.`);
      }
      const { table, contests, settled, counted } = seasonOf(cup, leagueTable, contestsOf.get(cup.id) ?? [], byContest);
      const squads = cupSquads(leagueSquads, counted);
      const pointsAfter = runningPoints(table, squads, counted);
      const countedIds = new Set(counted.map((row) => row.contest.id));
      return {
        cup,
        sportLeagueName,
        standings: cup.status === CupStatus.CROWNED
          ? (frozenByCup.get(cup.id) ?? []).flatMap((row) => {
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
    });
  }
}

/**
 * The cups that list a contest, each with its contests in the order read. A cup none of whose
 * contests is listed (its only contest was moved to another season, or is still a draft) is left out.
 */
function listedCups(cups: readonly Cup[], contests: readonly LeagueCupContest[]): { cups: Cup[]; contestsOf: Map<string, CupContest[]> } {
  const byKey = new Map<string, CupContest[]>();
  for (const row of contests) {
    const key = cupKeyOf(row);
    const rows = byKey.get(key);
    if (rows === undefined) byKey.set(key, [row.contest]);
    else rows.push(row.contest);
  }
  const listed = cups.filter((cup) => byKey.has(cupKeyOf(cup)));
  return { cups: listed, contestsOf: new Map(listed.map((cup) => [cup.id, byKey.get(cupKeyOf(cup)) ?? []])) };
}

function cupKeyOf(key: Pick<CupKey, 'seasonYear' | 'sportLeagueId'>): string {
  return `${String(key.seasonYear)}:${key.sportLeagueId}`;
}

function finalContestIds(contests: readonly CupContest[]): string[] {
  return contests.filter((contest) => contest.status === ContestStatus.COMPLETED).map((contest) => contest.id);
}

/** A cup's season from its contests and the settled finishes of the league's contests. */
function seasonOf(cup: Cup, leagueTable: CupPointsTable, contests: readonly CupContest[], finishesByContest: ReadonlyMap<string, CupContestFinish[]>): CupSeason {
  const settled = new Map(contests
    .filter((contest) => contest.status === ContestStatus.COMPLETED)
    .map((contest): [string, SettledContest] => {
      const finishes = finishesByContest.get(contest.id) ?? [];
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
  return { table: cup.crownedPointsTable ?? leagueTable, contests: [...contests], settled, counted };
}

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
