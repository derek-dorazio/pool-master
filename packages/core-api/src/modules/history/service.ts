/**
 * League history (#837): what happened in a championship year, contest by contest, and the All
 * years summary. It stores nothing: it reads the finishes the championship wrote at settlement, so
 * every list matches the finish matrix it drills from, and the championship's and cups' own reads.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { ChampionshipRepository, FinalContest, LeagueRepository, SquadRepository } from '@poolmaster/shared/db';
import {
  ContestResultCount,
  CupContestCount,
  CupStatus,
  CupTrophy,
  CupWeight,
  SummaryTile,
  TrophyKind,
  championshipYear,
  championshipYearStart,
  trophyForPlace,
  type RecordType,
  type SelectionType,
  type LeagueYearFinish,
  type Squad,
} from '@poolmaster/shared/domain';

import type { ChampionshipService, ChampionshipStandingView, ChampionshipYearView } from '../championship/service';
import type { CupService, CupStandingView, CupView } from '../cups/service';
import { buildPerpetualTrophies, type PerpetualTrophy } from './perpetual-trophies';
import { rankRecords, type RecordStand } from './records';

/** No date range: the record book names its contests by id alone. */
const NO_DATE = new Date(0);

type HistoryLogger = Pick<FastifyBaseLogger, 'debug' | 'warn'>;

export class HistorySquadNotFoundError extends Error {
  readonly code = 'SQUAD_NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'HistorySquadNotFoundError';
  }
}

export class HistorySquadRequiredError extends Error {
  readonly code = 'SQUAD_ID_REQUIRED';

  constructor(message: string) {
    super(message);
    this.name = 'HistorySquadRequiredError';
  }
}

/** Narrows a year's contests to one squad's counted ones, or to one cell of its matrix row. */
export interface ContestResultFilter {
  squadId?: string;
  /** 1st to 10th; only with `squadId`. */
  place?: number;
}

export interface ContestResultSquadFinishView {
  place: number;
  tiedCount: number;
  /** Tenths of a point. */
  points: number;
}

export interface ContestResultView {
  contestId: string;
  name: string;
  sportLeagueName: string;
  selectionType: SelectionType;
  completedAt: Date;
  rankedEntryCount: number;
  count: ContestResultCount;
  winners: Squad[];
  squadFinish: ContestResultSquadFinishView | null;
}

export interface HistorySummaryTileView {
  tile: SummaryTile;
  count: number;
  squads: Squad[];
}

export interface HistoryCupView {
  view: CupView;
  contestsCounted: number;
  /** A crowned cup's champions; an open cup's leaders. */
  winners: Squad[];
}

export interface HistoryYearView {
  year: number;
  isOver: boolean;
  /** The championship's champions once the year is over, its leaders before. */
  champions: Squad[];
  cups: HistoryCupView[];
}

export interface HistorySummaryView {
  tiles: HistorySummaryTileView[];
  years: HistoryYearView[];
}

/** One squad's row of a championship year, with what the squad page needs around it. */
export interface SquadChampionshipView {
  cupName: string;
  isOver: boolean;
  standing: ChampionshipStandingView;
  squadCount: number;
  /** Tenths of a point behind 1st. */
  pointsBehindLeader: number;
  contestsCounted: number;
  contestsToGo: number;
}

/** One squad's row of a cup. */
export interface SquadCupView {
  view: CupView;
  contestsCounted: number;
  standing: CupStandingView;
}

export interface SquadYearView {
  squad: Squad;
  year: number;
  championship: SquadChampionshipView | null;
  cups: SquadCupView[];
}

/** A trophy on a squad's shelf: a championship finished on the podium in a year that is over, or a crowned cup's trophy. */
export type SquadTrophyView =
  | { kind: typeof TrophyKind.CHAMPIONSHIP; year: number; trophy: CupTrophy; cupName: string }
  | { kind: typeof TrophyKind.CUP; year: number; trophy: CupTrophy; cup: CupView };

/** A squad's whole history in the league: contest medals, its trophy shelf, and every year's rows. */
export interface SquadHistoryView {
  squad: Squad;
  /** Counted contests it finished 1st, 2nd and 3rd in, all time. */
  medals: { firsts: number; seconds: number; thirds: number };
  /** Newest first; within a year the championship first, then cups by sports league. */
  trophies: SquadTrophyView[];
  /** Every year the league has a championship or a cup season, newest first. */
  years: SquadYearView[];
}

/** One holder of a record value: the squad, and the year or contest it was set in when the record names one. */
export interface RecordHolderView {
  squad: Squad;
  year: number | null;
  contest: FinalContest | null;
}

export interface RecordStandView {
  value: number;
  /** In squad name order, then newest year first. */
  holders: RecordHolderView[];
}

/** One record of the league's record book (#873): its holders, every one on a tie, and the next best. */
export interface RecordView {
  type: RecordType;
  best: RecordStandView;
  nextBest: RecordStandView | null;
}

/** A plate of a perpetual trophy (#874): the year's contest and its winners, none for no result. */
export interface PerpetualPlateView {
  year: number;
  contestId: string;
  /** In name order. */
  winners: Squad[];
}

/** One perpetual trophy (#874): a contest the league runs every year, with a plate per year. */
export interface PerpetualTrophyView extends Omit<PerpetualTrophy, 'plates'> {
  plates: PerpetualPlateView[];
}

export interface HistoryServiceDeps {
  finishes: Pick<ChampionshipRepository, 'findByLeague' | 'findByLeagueYear' | 'findFinalContests' | 'findSeriesContests'>;
  squads: Pick<SquadRepository, 'findById' | 'findByLeague'>;
  leagues: Pick<LeagueRepository, 'findById'>;
  championship: Pick<ChampionshipService, 'getYear' | 'listYears'>;
  cups: Pick<CupService, 'listSeasonYears' | 'listSeasonCups'>;
  logger?: HistoryLogger;
  now?: () => Date;
}

export class HistoryService {
  private readonly now: () => Date;

  constructor(private readonly deps: HistoryServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * All years: every year with a counted championship contest or a cup, newest first, with the
   * championship's champions (its leaders while the year runs) and each cup's champions (its
   * leaders while open); and the tiles for most championships and most cups won.
   */
  async getSummary(leagueId: string): Promise<HistorySummaryView> {
    const [championshipYears, seasonYears] = await Promise.all([
      this.deps.championship.listYears(leagueId),
      this.deps.cups.listSeasonYears(leagueId),
    ]);
    const seasons = await Promise.all(seasonYears.map(async (seasonYear) => [seasonYear, await this.deps.cups.listSeasonCups(leagueId, seasonYear)] as const));
    const cupsBySeason = new Map(seasons);
    const championsByYear = new Map(championshipYears.map((row) => [row.year, row.leaders]));
    const currentYear = championshipYear(this.now());

    const years = [...new Set([...championsByYear.keys(), ...cupsBySeason.keys()])]
      .sort((left, right) => right - left)
      .map((year): HistoryYearView => ({
        year,
        isOver: year < currentYear,
        champions: byName(championsByYear.get(year) ?? []),
        cups: (cupsBySeason.get(year) ?? [])
          .map((view) => ({
            view,
            contestsCounted: view.contests.filter((contest) => contest.count === CupContestCount.COUNTED).length,
            winners: byName(view.cup.status === CupStatus.CROWNED
              ? view.standings.filter((row) => row.trophy === CupTrophy.CHAMPION).map((row) => row.squad)
              : view.standings.filter((row) => row.position === 1 && row.points > 0).map((row) => row.squad)),
          }))
          .sort((left, right) => left.view.sportLeagueName.localeCompare(right.view.sportLeagueName)),
      }));

    const championships = years.filter((row) => row.isOver).flatMap((row) => row.champions);
    const cupWins = years.flatMap((row) => row.cups.filter((cup) => cup.view.cup.status === CupStatus.CROWNED).flatMap((cup) => cup.winners));
    this.deps.logger?.debug({ action: 'history.summary', data: { leagueId, yearCount: years.length } }, 'Read the league\'s All years summary');
    return {
      tiles: [mostOf(SummaryTile.MOST_CHAMPIONSHIPS, championships), mostOf(SummaryTile.MOST_CUPS, cupWins)],
      years,
    };
  }

  /**
   * The record book (#873): every record somebody holds, worked out from the league's counted
   * contest finishes and its championships of years over, with the Hall of Lame's records unless
   * the league hides them. A squad that has since gone inactive still holds its records.
   */
  async getRecords(leagueId: string): Promise<RecordView[]> {
    const [finishes, championshipYears, squads, league] = await Promise.all([
      this.deps.finishes.findByLeague(leagueId),
      this.deps.championship.listYears(leagueId),
      this.deps.squads.findByLeague(leagueId, true),
      this.deps.leagues.findById(leagueId),
    ]);
    // The route has checked membership, so the league is there; were it gone, the Hall of Lame stays hidden.
    const hallOfLame = league?.hallOfLameVisible ?? false;
    const ranked = rankRecords(finishes, championshipYears
      .filter((row) => row.isOver)
      .map((row) => ({ year: row.year, championSquadIds: row.leaders.map((squad) => squad.id) })), { hallOfLame });
    const contestIds = [...new Set(ranked.flatMap((record) => [record.best, ...(record.nextBest === null ? [] : [record.nextBest])])
      .flatMap((stand) => stand.holders.flatMap((holder) => holder.contestId ?? [])))];
    const contests = contestIds.length === 0 ? [] : await this.deps.finishes.findFinalContests(leagueId, NO_DATE, NO_DATE, contestIds);
    const squadsById = new Map(squads.map((squad) => [squad.id, squad]));
    const contestsById = new Map(contests.map((contest) => [contest.id, contest]));
    const standView = (stand: RecordStand): RecordStandView => ({
      value: stand.value,
      holders: stand.holders
        .flatMap((holder): RecordHolderView[] => {
          const squad = squadsById.get(holder.squadId);
          return squad === undefined ? [] : [{ squad, year: holder.year, contest: holder.contestId === null ? null : contestsById.get(holder.contestId) ?? null }];
        })
        .sort((left, right) => left.squad.name.localeCompare(right.squad.name) || (right.year ?? 0) - (left.year ?? 0)),
    });
    this.deps.logger?.debug({ action: 'history.records', data: { leagueId, recordCount: ranked.length, hallOfLame } }, 'Read the league\'s record book');
    return ranked.map((record) => ({ type: record.type, best: standView(record.best), nextBest: record.nextBest === null ? null : standView(record.nextBest) }));
  }

  /**
   * The league's perpetual trophies (#874): every contest of one event it has run in two or more
   * years, the same series and selection type, with a plate per year naming its winners. A week of
   * games and a contest not counted earn none. A squad that has since gone inactive keeps its plates.
   */
  async getPerpetualTrophies(leagueId: string): Promise<PerpetualTrophyView[]> {
    const [contests, finishes, squads] = await Promise.all([
      this.deps.finishes.findSeriesContests(leagueId),
      this.deps.finishes.findByLeague(leagueId),
      this.deps.squads.findByLeague(leagueId, true),
    ]);
    const squadsById = new Map(squads.map((squad) => [squad.id, squad]));
    const trophies = buildPerpetualTrophies(contests, finishes).map((trophy) => ({
      ...trophy,
      plates: trophy.plates.map(({ winnerSquadIds, ...plate }) => ({
        ...plate,
        winners: winnerSquadIds
          .flatMap((squadId) => squadsById.get(squadId) ?? [])
          .sort((left, right) => left.name.localeCompare(right.name)),
      })),
    }));
    this.deps.logger?.debug({ action: 'history.perpetualTrophies', data: { leagueId, trophyCount: trophies.length } }, 'Read the league\'s perpetual trophies');
    return trophies;
  }

  /**
   * One squad's year for its squad page (#872): its row of the championship and of each cup of the
   * season, read through the same services the league pages use, so the two can never disagree.
   */
  async getSquadYear(leagueId: string, squadId: string, year: number): Promise<SquadYearView> {
    const squad = await this.requireLeagueSquad(leagueId, squadId, 'history.squadYear.squadNotFound');
    const view = await this.readSquadYear(leagueId, squad, year);
    this.deps.logger?.debug({ action: 'history.squadYear', data: { leagueId, squadId, year, cupCount: view.cups.length } }, 'Read a squad\'s year');
    return view;
  }

  /**
   * A squad's whole history for its squad page (#872): its contest medals all time, its trophy
   * shelf (championship podiums in years that are over, crowned cups' trophies), and its rows of
   * every year the league has a championship or a cup season in, newest first.
   */
  async getSquadHistory(leagueId: string, squadId: string): Promise<SquadHistoryView> {
    const squad = await this.requireLeagueSquad(leagueId, squadId, 'history.squadHistory.squadNotFound');
    const [championshipYears, seasonYears] = await Promise.all([
      this.deps.championship.listYears(leagueId),
      this.deps.cups.listSeasonYears(leagueId),
    ]);
    const yearNumbers = [...new Set([...championshipYears.map((row) => row.year), ...seasonYears])].sort((left, right) => right - left);
    const years = await Promise.all(yearNumbers.map((year) => this.readSquadYear(leagueId, squad, year)));
    const trophies = years.flatMap(squadYearTrophies);
    this.deps.logger?.debug({ action: 'history.squadHistory', data: { leagueId, squadId, yearCount: years.length, trophyCount: trophies.length } }, 'Read a squad\'s history');
    return {
      squad,
      // Summed from the years' championship rows, so they always match the Championship tab.
      medals: {
        firsts: sumFinishes(years, 0),
        seconds: sumFinishes(years, 1),
        thirds: sumFinishes(years, 2),
      },
      trophies,
      years,
    };
  }

  private async requireLeagueSquad(leagueId: string, squadId: string, action: string): Promise<Squad> {
    const squad = await this.deps.squads.findById(squadId);
    if (squad === null || squad.leagueId !== leagueId) {
      this.deps.logger?.warn({ action, data: { leagueId, squadId } }, 'Squad history asked for a squad outside the league');
      throw new HistorySquadNotFoundError(`Squad ${squadId} is not in this league.`);
    }
    return squad;
  }

  /**
   * Every active squad's year (#872 slice 4, the year in review), from one read of the year's
   * championship and cups, by squad name.
   */
  async getLeagueSquadYears(leagueId: string, year: number): Promise<SquadYearView[]> {
    const [squads, championship, cups] = await Promise.all([
      this.deps.squads.findByLeague(leagueId),
      this.deps.championship.getYear(leagueId, year),
      this.deps.cups.listSeasonCups(leagueId, year),
    ]);
    return [...squads]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((squad) => squadYearFrom(squad, year, championship, cups));
  }

  /** One year of a squad, from the same championship and cup reads as the league pages. */
  private async readSquadYear(leagueId: string, squad: Squad, year: number): Promise<SquadYearView> {
    const [championship, cups] = await Promise.all([
      this.deps.championship.getYear(leagueId, year),
      this.deps.cups.listSeasonCups(leagueId, year),
    ]);
    return squadYearFrom(squad, year, championship, cups);
  }

  /**
   * The contests that went final in a championship year, newest first. Unfiltered, every one,
   * counted or not. For a squad, only the counted contests it placed in (its Played count); with a
   * place, only those it finished in that place (its matrix cell).
   */
  async listYearContests(leagueId: string, year: number, filter: ContestResultFilter = {}): Promise<ContestResultView[]> {
    const { squadId, place } = filter;
    if (squadId === undefined && place !== undefined) {
      this.deps.logger?.warn({ action: 'history.contests.squadRequired', data: { leagueId, year, place } }, 'Year contests asked for a place without a squad');
      throw new HistorySquadRequiredError('A place filter needs a squadId.');
    }
    if (squadId !== undefined) {
      const squad = await this.deps.squads.findById(squadId);
      if (squad === null || squad.leagueId !== leagueId) {
        this.deps.logger?.warn({ action: 'history.contests.squadNotFound', data: { leagueId, year, squadId } }, 'Year contests asked for a squad outside the league');
        throw new HistorySquadNotFoundError(`Squad ${squadId} is not in this league.`);
      }
    }

    const finishes = await this.deps.finishes.findByLeagueYear(leagueId, year);
    const byContest = new Map<string, LeagueYearFinish[]>();
    for (const finish of finishes) {
      byContest.set(finish.contestId, [...(byContest.get(finish.contestId) ?? []), finish]);
    }
    // A squad's list is its counted finishes, as the matrix counts them.
    const squadRows = new Map(finishes
      .filter((finish) => finish.squadId === squadId && finish.weight !== CupWeight.NOT_COUNTED && (place === undefined || finish.place === place))
      .map((finish) => [finish.contestId, finish]));
    // Finishes name their contests even where a contest's end time was never kept.
    const contestIds = squadId === undefined ? [...byContest.keys()] : [...squadRows.keys()];
    const [contests, squads] = await Promise.all([
      this.deps.finishes.findFinalContests(leagueId, championshipYearStart(year), championshipYearStart(year + 1), contestIds),
      this.deps.squads.findByLeague(leagueId, true),
    ]);
    const squadById = new Map(squads.map((squad) => [squad.id, squad]));

    const views = contests.flatMap((contest): ContestResultView[] => {
      if (squadId !== undefined && !squadRows.has(contest.id)) return [];
      const rows = byContest.get(contest.id) ?? [];
      const completedAt = contest.completedAt ?? rows.at(0)?.settledAt;
      if (completedAt === undefined) return [];
      const squadRow = squadRows.get(contest.id);
      return [{
        contestId: contest.id,
        name: contest.name,
        sportLeagueName: contest.sportLeagueName,
        selectionType: contest.selectionType,
        completedAt,
        rankedEntryCount: rows.at(0)?.rankedEntryCount ?? 0,
        count: resultCount(rows),
        winners: rows
          .filter((row) => row.place === 1)
          .flatMap((row) => squadById.get(row.squadId) ?? [])
          .sort((left, right) => left.name.localeCompare(right.name)),
        squadFinish: squadRow === undefined ? null : { place: squadRow.place, tiedCount: squadRow.tiedCount, points: squadRow.points },
      }];
    }).sort((left, right) => right.completedAt.getTime() - left.completedAt.getTime() || left.name.localeCompare(right.name));
    this.deps.logger?.debug({ action: 'history.contests', data: { leagueId, year, squadId, place, contestCount: views.length } }, 'Listed a year\'s final contests');
    return views;
  }
}

function resultCount(rows: readonly LeagueYearFinish[]): ContestResultCount {
  const first = rows.at(0);
  if (first === undefined) return ContestResultCount.NO_RESULT;
  return first.weight === CupWeight.NOT_COUNTED ? ContestResultCount.NOT_COUNTED : ContestResultCount.COUNTED;
}

function byName(squads: readonly Squad[]): Squad[] {
  return [...squads].sort((left, right) => left.name.localeCompare(right.name));
}

/** A tile: the most wins any squad has in `wins` (one entry per win), and every squad holding it. */
function mostOf(tile: SummaryTile, wins: readonly Squad[]): HistorySummaryTileView {
  const counts = new Map<string, { squad: Squad; count: number }>();
  for (const squad of wins) {
    counts.set(squad.id, { squad, count: (counts.get(squad.id)?.count ?? 0) + 1 });
  }
  const count = Math.max(0, ...[...counts.values()].map((row) => row.count));
  return {
    tile,
    count,
    squads: byName([...counts.values()].filter((row) => row.count === count && count > 0).map((row) => row.squad)),
  };
}

/** How many times the squad finished in a place (0 for 1st) over its championship rows. */
function sumFinishes(years: SquadYearView[], placeIndex: number): number {
  return years.reduce((total, year) => total + (year.championship?.standing.finishes[placeIndex] ?? 0), 0);
}

/** A squad's rows of a year's championship and cups. */
function squadYearFrom(squad: Squad, year: number, championship: ChampionshipYearView, cups: readonly CupView[]): SquadYearView {
  const squadId = squad.id;
  const standing = championship.standings.find((row) => row.squad.id === squadId);
  const leaderPoints = championship.standings.at(0)?.points ?? 0;
  const squadCups = cups
    .flatMap((view): SquadCupView[] => {
      const row = view.standings.find((candidate) => candidate.squad.id === squadId);
      return row === undefined ? [] : [{
        view,
        contestsCounted: view.contests.filter((contest) => contest.count === CupContestCount.COUNTED).length,
        standing: row,
      }];
    })
    .sort((left, right) => left.view.sportLeagueName.localeCompare(right.view.sportLeagueName));
  return {
    squad,
    year,
    championship: standing === undefined ? null : {
      cupName: championship.cupName,
      isOver: championship.isOver,
      standing,
      squadCount: championship.standings.length,
      pointsBehindLeader: leaderPoints - standing.points,
      contestsCounted: championship.contestsCounted,
      contestsToGo: championship.contestsToGo,
    },
    cups: squadCups,
  };
}

/** The trophies a squad took in a year: its championship podium once the year is over, then its crowned cups'. */
export function squadYearTrophies(year: SquadYearView): SquadTrophyView[] {
  const { championship } = year;
  const podium = championship !== null && championship.isOver
    ? trophyForPlace(championship.standing.position, championship.standing.points)
    : null;
  return [
    ...(podium === null || championship === null ? [] : [{ kind: TrophyKind.CHAMPIONSHIP, year: year.year, trophy: podium, cupName: championship.cupName }]),
    ...year.cups.flatMap((cup) => cup.standing.trophy === null ? [] : [{ kind: TrophyKind.CUP, year: year.year, trophy: cup.standing.trophy, cup: cup.view }]),
  ];
}
