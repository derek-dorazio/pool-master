/**
 * League history (#837): what happened in a championship year, contest by contest. It stores
 * nothing: it reads the finishes the championship wrote at settlement, so every list matches the
 * finish matrix it drills from.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { ChampionshipRepository, SquadRepository } from '@poolmaster/shared/db';
import {
  ContestResultCount,
  CupWeight,
  championshipYearStart,
  type SelectionType,
  type LeagueYearFinish,
  type Squad,
} from '@poolmaster/shared/domain';

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

export interface HistoryServiceDeps {
  finishes: Pick<ChampionshipRepository, 'findByLeagueYear' | 'findFinalContests'>;
  squads: Pick<SquadRepository, 'findById' | 'findByLeague'>;
  logger?: HistoryLogger;
}

export class HistoryService {
  constructor(private readonly deps: HistoryServiceDeps) {}

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
