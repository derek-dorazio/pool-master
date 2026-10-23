import { CHAMPIONSHIP_MATRIX_PLACES, ChampionshipTile, ContestResultCount, CupStatus, SummaryTile } from '@poolmaster/shared/domain';
import type { ChampionshipDto, ChampionshipStandingRowDto, ContestResultSummaryDto, HistoryCupDto, HistoryYearDto } from '@/lib/api';
import { CUP_SHOWN_FROM_COUNTED, formatCupPoints, formatOrdinalPlace, joinNames } from './cup-view';

/** How many finishing places the finish matrix counts: 1st to 10th. */
export const FINISH_MATRIX_PLACES = CHAMPIONSHIP_MATRIX_PLACES;

/** Each medal tile's label. A `Record`, so a new tile needs its label. */
export const CHAMPIONSHIP_TILE_LABELS: Record<ChampionshipTile, string> = {
  [ChampionshipTile.MOST_FIRSTS]: 'Most 1sts',
  [ChampionshipTile.MOST_SECONDS]: 'Most 2nds',
  [ChampionshipTile.MOST_THIRDS]: 'Most 3rds',
  [ChampionshipTile.MOST_PODIUMS]: 'Most podiums',
  [ChampionshipTile.MOST_TOP_TENS]: 'Most top tens',
  [ChampionshipTile.MOST_PLAYED]: 'Most played',
};

/** The squads in 1st, once any contest has counted; nobody leads a championship still at 0. */
function championshipLeaders(championship: ChampionshipDto): ChampionshipStandingRowDto[] {
  return championship.standings.filter((row) => row.position === 1 && row.points > 0);
}

/** One step of a podium: its place and every squad sharing it. */
export type PodiumStep = {
  place: 1 | 2 | 3;
  squads: { squadId: string; squadName: string; points: number }[];
};

/**
 * The podium: 1st, 2nd and 3rd with every squad on each, squads at 0 left off. A shared place
 * leaves the next step empty (two tied 1sts and the next squad is 3rd), so that step is left out.
 */
export function buildPodium(rows: { squadId: string; squadName: string; position: number; points: number }[]): PodiumStep[] {
  return ([1, 2, 3] as const)
    .map((place) => ({
      place,
      squads: rows
        .filter((row) => row.position === place && row.points > 0)
        .map(({ squadId, squadName, points }) => ({ squadId, squadName, points })),
    }))
    .filter((step) => step.squads.length > 0);
}

/**
 * The line under the championship's name. Once the year is over it names the champion; while it
 * runs, who leads and by how much, and how many contests are still to count.
 */
export function describeChampionshipStanding(championship: ChampionshipDto): string {
  const leaders = championshipLeaders(championship);
  if (!leaders.length) {
    return championship.isOver
      ? `No contest counted in ${championship.year}.`
      : `No contest has counted in ${championship.year} yet.`;
  }
  const names = joinNames(leaders.map((row) => row.squadName));
  if (championship.isOver) {
    return leaders.length === 1 ? `${names} won with ${formatCupPoints(leaders[0]?.points ?? 0)} points.` : `${names} share the championship.`;
  }
  const chaser = championship.standings.find((row) => row.position > 1);
  const lead = leaders.length > 1
    ? `${names} share the lead`
    : chaser
      ? `${names} leads by ${formatCupPoints((leaders[0]?.points ?? 0) - chaser.points)} points`
      : `${names} leads`;
  const toGo = championship.contestsToGo;
  return toGo ? `${lead} with ${toGo} ${toGo === 1 ? 'contest' : 'contests'} to go.` : `${lead}.`;
}

/** What narrows a year's contest list: one squad's counted contests, or with a place one cell of its matrix row. */
export type ContestResultFilter = { squadId: string; place: number | null };

/**
 * The contest list's filter from the page's search (`?squad=…&place=…`), so a filtered list can be
 * shared. Only a squad in the standings counts, and a place only from 1st to 10th.
 */
export function parseContestResultFilter(search: URLSearchParams, standings: ChampionshipStandingRowDto[]): ContestResultFilter | null {
  const squadId = search.get('squad');
  if (squadId === null || !standings.some((row) => row.squadId === squadId)) {
    return null;
  }
  const place = Number(search.get('place'));
  return { squadId, place: Number.isInteger(place) && place >= 1 && place <= FINISH_MATRIX_PLACES ? place : null };
}

/** The contest list's heading: the year's contests, a squad's, or those it finished in one place. */
export function describeContestResultFilter(filter: ContestResultFilter | null, squadName: string, year: number): string {
  if (filter === null) {
    return `Contests in ${year}`;
  }
  return filter.place === null
    ? `Contests ${squadName} played in ${year}`
    : `Contests ${squadName} finished ${formatOrdinalPlace(filter.place)} in ${year}`;
}

export type ContestResultState = { badge: string | null; note: string };

/** A final contest's line: who won it and how many entries, or why it has no winner; and whether it counted. */
export function describeContestResult(contest: ContestResultSummaryDto): ContestResultState {
  const won = `Won by ${joinNames(contest.winners.map((winner) => winner.squadName))} · ${contest.rankedEntryCount} ${contest.rankedEntryCount === 1 ? 'entry' : 'entries'}`;
  switch (contest.count) {
    case ContestResultCount.COUNTED:
      return { badge: null, note: won };
    case ContestResultCount.NOT_COUNTED:
      return { badge: 'Not counted', note: won };
    case ContestResultCount.NO_RESULT:
      return { badge: 'No result', note: 'Every event was cancelled, so nobody placed' };
  }
}

/** Each All years tile's label. A `Record`, so a new tile needs its label. */
export const SUMMARY_TILE_LABELS: Record<SummaryTile, string> = {
  [SummaryTile.MOST_CHAMPIONSHIPS]: 'Most championships',
  [SummaryTile.MOST_CUPS]: 'Most cups',
};

/** A year as All years heads it: "2026 so far" while it runs. */
export function historyYearTitle(year: Pick<HistoryYearDto, 'year' | 'isOver'>): string {
  return year.isOver ? String(year.year) : `${year.year} so far`;
}

/** Who won the year's championship, or leads it while the year runs. */
export function describeHistoryChampions(year: HistoryYearDto): string {
  if (!year.champions.length) {
    return 'No championship contest counted';
  }
  const names = joinNames(year.champions.map((squad) => squad.squadName));
  if (!year.isOver) {
    return `${names} ${year.champions.length > 1 ? 'lead' : 'leads'}`;
  }
  return year.champions.length > 1 ? `Champions: ${names}` : `Champion: ${names}`;
}

/** A cup's line on All years: its champions once crowned, its leaders while open, or nobody yet. */
export function describeHistoryCup(cup: HistoryCupDto): string {
  if (!cup.winners.length) {
    return cup.status === CupStatus.CROWNED ? 'Crowned' : 'Nobody leads yet';
  }
  const names = joinNames(cup.winners.map((squad) => squad.squadName));
  return cup.status === CupStatus.CROWNED ? `Won by ${names}` : `${names} ${cup.winners.length > 1 ? 'lead' : 'leads'}`;
}

/** The cups All years shows: as on the Trophy case, a cup once enough of its contests have counted. */
export function historyCupsOnShow(cups: HistoryCupDto[]): HistoryCupDto[] {
  return cups.filter((cup) => cup.contestsCounted >= CUP_SHOWN_FROM_COUNTED);
}
