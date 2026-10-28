/**
 * The league championship (#863): every counted contest of every sport, in the calendar year it
 * went final (US Eastern). Unlike a cup, it is stored: each squad's finish is written once, at
 * settlement, with the points it earned then, so a later points table or weight change never
 * shifts a past year. A year freezes itself: once it is over, no contest can go final in it.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { ChampionshipRepository, CupRepository, SquadRepository } from '@poolmaster/shared/db';
import {
  type ChampionshipTile,
  CupWeight,
  championshipTiles,
  championshipYear,
  cupFinishPoints,
  rankChampionshipTallies,
  squadContestFinishes,
  tallyChampionship,
  type Contest,
  type LeagueYearFinish,
  type Squad,
} from '@poolmaster/shared/domain';

type ChampionshipLogger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn'>;

export class ChampionshipLeagueNotFoundError extends Error {
  readonly code = 'LEAGUE_NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'ChampionshipLeagueNotFoundError';
  }
}

/** One squad's place in a championship year. */
export interface ChampionshipStandingView {
  squad: Squad;
  position: number;
  displayPosition: string;
  /** Tenths of a point. */
  points: number;
  /** Finishes in 1st to 10th: `finishes[0]` counts 1sts. */
  finishes: number[];
  podiums: number;
  topTens: number;
  played: number;
  /** Places gained (positive) or lost since before the year's latest counted contest; null until two have counted, and once the year is over. */
  movement: number | null;
}

export interface ChampionshipTileView {
  tile: ChampionshipTile;
  count: number;
  squads: Squad[];
}

export interface ChampionshipYearView {
  leagueId: string;
  year: number;
  cupName: string;
  /** True once the year has ended in US Eastern: the championship is decided. */
  isOver: boolean;
  /** Counted contests that went final in the year. */
  contestsCounted: number;
  /** The league's open and live counted contests, for the current year only; 0 for any other. */
  contestsToGo: number;
  standings: ChampionshipStandingView[];
  tiles: ChampionshipTileView[];
}

export interface ChampionshipYearSummaryView {
  year: number;
  isOver: boolean;
  /** The squads in 1st, several on a tie: the champions once the year is over, the leaders before. */
  leaders: Squad[];
}

export interface ChampionshipServiceDeps {
  finishes: ChampionshipRepository;
  cups: Pick<CupRepository, 'findRankedEntries' | 'findPointsTable'>;
  squads: SquadRepository;
  logger?: ChampionshipLogger;
  now?: () => Date;
}

export class ChampionshipService {
  private readonly now: () => Date;

  constructor(private readonly deps: ChampionshipServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Writes a contest's finishes as it goes final: each squad once, from its best entry's frozen
   * place, scored on the league's points table and the contest's weight. Settlement calls it after
   * freezing the places and before completing the contest, so a failure leaves the contest to be
   * settled again. A second call for the contest writes nothing. Answers how many it wrote.
   */
  async recordContest(contest: Pick<Contest, 'id' | 'leagueId' | 'cupWeight'>, settledAt: Date): Promise<number> {
    const table = await this.deps.cups.findPointsTable(contest.leagueId);
    if (table === null) {
      this.deps.logger?.warn({ action: 'championship.record.leagueMissing', data: { contestId: contest.id, leagueId: contest.leagueId } }, 'Championship finishes not written: the contest\'s league is gone');
      return 0;
    }
    const finishes = squadContestFinishes(await this.deps.cups.findRankedEntries([contest.id]));
    if (finishes.length === 0) {
      this.deps.logger?.debug({ action: 'championship.record.noResult', data: { contestId: contest.id } }, 'Championship finishes not written: nobody placed');
      return 0;
    }
    const year = championshipYear(settledAt);
    const written = await this.deps.finishes.recordFinishes(finishes.map((finish) => ({
      leagueId: contest.leagueId,
      year,
      squadId: finish.squadId,
      contestId: contest.id,
      place: finish.place,
      tiedCount: finish.tiedCount,
      rankedEntryCount: finish.rankedEntryCount,
      weight: contest.cupWeight,
      points: cupFinishPoints(table, finish, contest.cupWeight),
      settledAt,
    })));
    this.deps.logger?.info({ action: 'championship.record', data: { contestId: contest.id, leagueId: contest.leagueId, year, written } }, 'Wrote a settled contest\'s championship finishes');
    return written;
  }

  /** One year of the league championship: its standings, medal tiles and progress. */
  async getYear(leagueId: string, year: number): Promise<ChampionshipYearView> {
    const cupName = await this.requireCupName(leagueId, year);
    const currentYear = championshipYear(this.now());
    const [finishes, leagueSquads, unfinished] = await Promise.all([
      this.deps.finishes.findByLeagueYear(leagueId, year),
      this.deps.squads.findByLeague(leagueId, true),
      year === currentYear ? this.deps.finishes.countUnfinishedContests(leagueId) : Promise.resolve(0),
    ]);
    this.deps.logger?.debug({ action: 'championship.year', data: { leagueId, year, finishCount: finishes.length } }, 'Read a championship year');
    return yearView({ leagueId, year, cupName, currentYear, unfinished }, finishes, leagueSquads);
  }

  /**
   * Every year the league has a counted finish in, and each of `alsoYears`, newest first, each as
   * `getYear` reads it, from one read of the league's finishes: a squad's whole history reads
   * every year at once.
   */
  async getAllYears(leagueId: string, alsoYears: readonly number[] = []): Promise<ChampionshipYearView[]> {
    const cupName = await this.requireCupName(leagueId, null);
    const currentYear = championshipYear(this.now());
    const [finishes, leagueSquads, unfinished] = await Promise.all([
      this.deps.finishes.findByLeague(leagueId),
      this.deps.squads.findByLeague(leagueId, true),
      this.deps.finishes.countUnfinishedContests(leagueId),
    ]);
    const byYear = new Map<number, LeagueYearFinish[]>();
    for (const finish of finishes) {
      byYear.set(finish.year, [...(byYear.get(finish.year) ?? []), finish]);
    }
    const years = [...new Set([
      ...finishes.filter((finish) => finish.weight !== CupWeight.NOT_COUNTED).map((finish) => finish.year),
      ...alsoYears,
    ])].sort((left, right) => right - left);
    this.deps.logger?.debug({ action: 'championship.allYears', data: { leagueId, yearCount: years.length, finishCount: finishes.length } }, 'Read every championship year');
    return years.map((year) => yearView({ leagueId, year, cupName, currentYear, unfinished: year === currentYear ? unfinished : 0 }, byYear.get(year) ?? [], leagueSquads));
  }

  private async requireCupName(leagueId: string, year: number | null): Promise<string> {
    const cupName = await this.deps.finishes.findCupName(leagueId);
    if (cupName === null) {
      this.deps.logger?.warn({ action: 'championship.year.leagueNotFound', data: { leagueId, year } }, 'Championship asked for a league that does not exist');
      throw new ChampionshipLeagueNotFoundError(`League ${leagueId} was not found.`);
    }
    return cupName;
  }

  /** Every year the league has a counted finish in, newest first, with who leads or won it. */
  async listYears(leagueId: string): Promise<ChampionshipYearSummaryView[]> {
    const [finishes, leagueSquads] = await Promise.all([
      this.deps.finishes.findByLeague(leagueId),
      this.deps.squads.findByLeague(leagueId, true),
    ]);
    const currentYear = championshipYear(this.now());
    const squadById = new Map(leagueSquads.map((squad) => [squad.id, squad]));
    const byYear = new Map<number, LeagueYearFinish[]>();
    for (const finish of finishes) {
      if (finish.weight === CupWeight.NOT_COUNTED) continue;
      byYear.set(finish.year, [...(byYear.get(finish.year) ?? []), finish]);
    }
    const years = [...byYear].sort(([left], [right]) => right - left).map(([year, rows]) => {
      const squadIds = [...new Set(rows.map((row) => row.squadId))]
        .sort((left, right) => (squadById.get(left)?.name ?? '').localeCompare(squadById.get(right)?.name ?? ''));
      const leaders = rankChampionshipTallies(tallyChampionship(squadIds, rows))
        .filter((row) => row.position === 1 && row.points > 0)
        .flatMap((row) => squadById.get(row.squadId) ?? []);
      return { year, isOver: year < currentYear, leaders };
    });
    this.deps.logger?.debug({ action: 'championship.years', data: { leagueId, yearCount: years.length } }, 'Listed championship years');
    return years;
  }
}

/** A championship year from its finishes (in the order they were settled) and the league's squads. */
function yearView(
  year: { leagueId: string; year: number; cupName: string; currentYear: number; unfinished: number },
  finishes: readonly LeagueYearFinish[],
  leagueSquads: readonly Squad[],
): ChampionshipYearView {
  const counted = finishes.filter((finish) => finish.weight !== CupWeight.NOT_COUNTED);
  const placed = new Set(counted.map((finish) => finish.squadId));
  // Every active squad shows, at 0 until it places; an inactive one shows once it has placed.
  const squads = leagueSquads
    .filter((squad) => squad.isActive || placed.has(squad.id))
    .sort((left, right) => left.name.localeCompare(right.name));
  const squadById = new Map(squads.map((squad) => [squad.id, squad]));
  const tallies = tallyChampionship(squads.map((squad) => squad.id), counted);
  const ranked = rankChampionshipTallies(tallies);
  const isOver = year.year < year.currentYear;
  // A year that is over is final, as a crowned cup is: no movement.
  const before = isOver ? null : positionsBeforeLatest(squads.map((squad) => squad.id), counted);
  return {
    leagueId: year.leagueId,
    year: year.year,
    cupName: year.cupName,
    isOver,
    contestsCounted: new Set(counted.map((finish) => finish.contestId)).size,
    contestsToGo: year.unfinished,
    standings: ranked.flatMap((row) => {
      const squad = squadById.get(row.squadId);
      return squad === undefined ? [] : [{
        squad,
        position: row.position,
        displayPosition: row.displayPosition,
        points: row.points,
        finishes: row.finishes,
        podiums: row.podiums,
        topTens: row.topTens,
        played: row.played,
        movement: before === null ? null : (before.get(row.squadId) ?? row.position) - row.position,
      }];
    }),
    // Tiles name leaders in standings order.
    tiles: championshipTiles(ranked).map((tile) => ({
      tile: tile.tile,
      count: tile.count,
      squads: tile.squadIds.flatMap((squadId) => squadById.get(squadId) ?? []),
    })),
  };
}

/** Each squad's place before the year's latest counted contest went final; null until two have counted. */
function positionsBeforeLatest(squadIds: readonly string[], counted: readonly LeagueYearFinish[]): Map<string, number> | null {
  const latest = counted.reduce<LeagueYearFinish | null>((best, finish) => (
    best === null || finish.settledAt.getTime() > best.settledAt.getTime()
      || (finish.settledAt.getTime() === best.settledAt.getTime() && finish.contestId > best.contestId)
      ? finish
      : best
  ), null);
  if (latest === null || new Set(counted.map((finish) => finish.contestId)).size < 2) {
    return null;
  }
  const earlier = counted.filter((finish) => finish.contestId !== latest.contestId);
  return new Map(rankChampionshipTallies(tallyChampionship(squadIds, earlier)).map((row) => [row.squadId, row.position]));
}
