import { ChampionshipTile } from '@poolmaster/shared/domain';
import type { ChampionshipDto, ChampionshipStandingRowDto } from '@/lib/api';
import { formatCupPoints, joinNames } from './cup-view';

/** How many finishing places the finish matrix counts: 1st to 10th. */
export const FINISH_MATRIX_PLACES = 10;

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
