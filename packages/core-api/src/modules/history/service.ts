/**
 * League history (#837): what happened in a championship year, contest by contest, and the All
 * years summary. It stores nothing: it reads the finishes the championship wrote at settlement, so
 * every list matches the finish matrix it drills from, and the championship's and cups' own reads.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { ChampionshipRepository, SquadRepository } from '@poolmaster/shared/db';
import {
  ContestResultCount,
  CupContestCount,
  CupStatus,
  CupTrophy,
  CupWeight,
  SummaryTile,
  championshipYear,
  championshipYearStart,
  type SelectionType,
  type LeagueYearFinish,
  type Squad,
} from '@poolmaster/shared/domain';

import type { ChampionshipService } from '../championship/service';
import type { CupService, CupView } from '../cups/service';

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

export interface HistoryServiceDeps {
  finishes: Pick<ChampionshipRepository, 'findByLeagueYear' | 'findFinalContests'>;
  squads: Pick<SquadRepository, 'findById' | 'findByLeague'>;
  championship: Pick<ChampionshipService, 'listYears'>;
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
