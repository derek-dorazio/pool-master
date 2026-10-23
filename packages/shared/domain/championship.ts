/**
 * The league championship (#863): every counted contest of every sport, in the calendar year it
 * went final. Pure, so the championship service, its backfill check and the pages read alike.
 */
import { ChampionshipTile, CupWeight } from './enums';
import { rankTallies, type Ranked } from './cup-points';
import type { LeagueYearFinish } from './types';

/** The championship's year is decided in US Eastern for every league. */
export const CHAMPIONSHIP_TIME_ZONE = 'America/New_York';

/** The finish matrix's columns: 1st to 10th. */
export const CHAMPIONSHIP_MATRIX_PLACES = 10;

const yearFormat = new Intl.DateTimeFormat('en-US', { timeZone: CHAMPIONSHIP_TIME_ZONE, year: 'numeric' });

/** The championship year an instant falls in: 04:00Z on 1 January is still the old year in New York. */
export function championshipYear(at: Date): number {
  return Number(yearFormat.format(at));
}

/** A squad's championship year: its points and how often it finished in each place. */
export interface ChampionshipTally {
  squadId: string;
  /** Tenths of a point. */
  points: number;
  /** Finishes in 1st to 10th: `finishes[0]` counts 1sts. */
  finishes: number[];
  /** Finishes in 1st, 2nd or 3rd. */
  podiums: number;
  /** Finishes in the top ten. */
  topTens: number;
  /** Counted contests the squad placed in. */
  played: number;
}

/**
 * Each squad's tally from a year's finishes. Every squad in `squadIds` has one, at 0 until it
 * places; a NOT_COUNTED contest's finishes are left out.
 */
export function tallyChampionship(
  squadIds: readonly string[],
  finishes: readonly Pick<LeagueYearFinish, 'squadId' | 'place' | 'points' | 'weight'>[],
): ChampionshipTally[] {
  const tallies = new Map<string, ChampionshipTally>(squadIds.map((squadId) => [squadId, {
    squadId,
    points: 0,
    finishes: Array.from({ length: CHAMPIONSHIP_MATRIX_PLACES }, () => 0),
    podiums: 0,
    topTens: 0,
    played: 0,
  }]));
  for (const finish of finishes) {
    const tally = tallies.get(finish.squadId);
    if (!tally || finish.weight === CupWeight.NOT_COUNTED) continue;
    tally.points += finish.points;
    tally.played += 1;
    if (finish.place <= CHAMPIONSHIP_MATRIX_PLACES) {
      tally.finishes[finish.place - 1] = (tally.finishes[finish.place - 1] ?? 0) + 1;
      tally.topTens += 1;
    }
    if (finish.place <= 3) tally.podiums += 1;
  }
  return [...tallies.values()];
}

/** Ranks a championship year: more points, then more 1sts, then more 2nds; squads equal on all three share the place. */
export function rankChampionshipTallies<T extends ChampionshipTally>(tallies: readonly T[]): Ranked<T>[] {
  return rankTallies(tallies, (left, right) =>
    right.points - left.points
    || (right.finishes[0] ?? 0) - (left.finishes[0] ?? 0)
    || (right.finishes[1] ?? 0) - (left.finishes[1] ?? 0));
}

/** One medal tile: the most any squad has of its count, and every squad holding it. */
export interface ChampionshipTileLeader {
  tile: ChampionshipTile;
  count: number;
  /** Every squad tied on the most; empty while nobody has any. */
  squadIds: string[];
}

const TILE_COUNTS: Record<ChampionshipTile, (tally: ChampionshipTally) => number> = {
  [ChampionshipTile.MOST_FIRSTS]: (tally) => tally.finishes[0] ?? 0,
  [ChampionshipTile.MOST_SECONDS]: (tally) => tally.finishes[1] ?? 0,
  [ChampionshipTile.MOST_THIRDS]: (tally) => tally.finishes[2] ?? 0,
  [ChampionshipTile.MOST_PODIUMS]: (tally) => tally.podiums,
  [ChampionshipTile.MOST_TOP_TENS]: (tally) => tally.topTens,
  [ChampionshipTile.MOST_PLAYED]: (tally) => tally.played,
};

/** The medal tiles in display order, each with its leaders in the tallies' order. */
export function championshipTiles(tallies: readonly ChampionshipTally[]): ChampionshipTileLeader[] {
  return Object.values(ChampionshipTile).map((tile) => {
    const countOf = TILE_COUNTS[tile];
    const count = Math.max(0, ...tallies.map(countOf));
    return {
      tile,
      count,
      squadIds: count === 0 ? [] : tallies.filter((tally) => countOf(tally) === count).map((tally) => tally.squadId),
    };
  });
}
