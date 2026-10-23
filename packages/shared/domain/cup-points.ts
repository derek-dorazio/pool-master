/**
 * Cup and championship points (#841, #863): what a squad's finish in a contest earns, and how a
 * set of squads ranks on what they earned. Pure, so league settings can preview a points table
 * and the cups and championship services score exactly alike.
 *
 * Points are carried in tenths of a point: two squads tied for 2nd on the STANDARD table each
 * earn (80 + 65) / 2 = 72.5, stored as 725, summed exactly and shown to one decimal.
 */
import { CupPointsScale, CupWeight } from './enums';
import { assertNever } from './assert-never';

/** STANDARD points for 1st to 20th: 100 ... 27 to 10th, then 25 down by 2 to 7 for 11th to 20th. */
const STANDARD_POINTS = [100, 80, 65, 55, 48, 42, 37, 33, 30, 27, 25, 23, 21, 19, 17, 15, 13, 11, 9, 7] as const;
/** STANDARD points for every place after 20th. */
const STANDARD_POINTS_AFTER = 5;
const TOP_TEN_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] as const;

/** Each weight as a multiple of tenths: x1 is 10, x1.5 is 15. */
const WEIGHT_TENTHS: Record<CupWeight, number> = {
  [CupWeight.NORMAL]: 10,
  [CupWeight.BONUS]: 15,
  [CupWeight.DOUBLE]: 20,
  [CupWeight.NOT_COUNTED]: 0,
};

/** A league's points table: its scale, and for CUSTOM the commissioner's points for 1st, 2nd ... */
export interface CupPointsTable {
  scale: CupPointsScale;
  customPoints: readonly number[];
}

/** Whole points one place earns on a table, untied and unweighted; `rankedEntryCount` serves FIELD_BEATEN. */
export function cupPlacePoints(table: CupPointsTable, place: number, rankedEntryCount: number): number {
  switch (table.scale) {
    case CupPointsScale.STANDARD:
      return STANDARD_POINTS[place - 1] ?? STANDARD_POINTS_AFTER;
    case CupPointsScale.TOP_TEN:
      return TOP_TEN_POINTS[place - 1] ?? 0;
    case CupPointsScale.FIELD_BEATEN:
      return Math.max(0, rankedEntryCount - place + 1);
    case CupPointsScale.CUSTOM:
      return table.customPoints[place - 1] ?? 0;
    default:
      return assertNever(table.scale);
  }
}

/** One squad's finish in one contest: its best entry's place, how many entries share it, and the ranked field. */
export interface SquadContestFinish {
  squadId: string;
  /** 1 is best; tied entries share the place. */
  place: number;
  /** Entries sharing the place, the squad's own included. */
  tiedCount: number;
  /** Entries ranked in the contest. */
  rankedEntryCount: number;
}

/**
 * The points a finish earns, in tenths: tied entries split the points of the places they cover
 * (two tied for 2nd share 2nd and 3rd), then the contest's weight applies. Rounded to the tenth.
 */
export function cupFinishPoints(
  table: CupPointsTable,
  finish: Pick<SquadContestFinish, 'place' | 'tiedCount' | 'rankedEntryCount'>,
  weight: CupWeight,
): number {
  let covered = 0;
  for (let place = finish.place; place < finish.place + finish.tiedCount; place++) {
    covered += cupPlacePoints(table, place, finish.rankedEntryCount);
  }
  return Math.round((covered * WEIGHT_TENTHS[weight]) / finish.tiedCount);
}

/** One ranked entry of a settled contest. */
export interface RankedContestEntry {
  squadId: string;
  position: number;
}

/**
 * Each squad's finish in a contest, from its best entry (#841, #863): a squad with two entries
 * scores once, from the better place. Every entry still holds its place, so a squad's second
 * entry pushes the others down as it would on the leaderboard.
 */
export function squadContestFinishes(entries: readonly RankedContestEntry[]): SquadContestFinish[] {
  const sharing = new Map<number, number>();
  for (const entry of entries) {
    sharing.set(entry.position, (sharing.get(entry.position) ?? 0) + 1);
  }
  const best = new Map<string, number>();
  for (const entry of entries) {
    const current = best.get(entry.squadId);
    if (current === undefined || entry.position < current) {
      best.set(entry.squadId, entry.position);
    }
  }
  return [...best].map(([squadId, place]) => ({
    squadId,
    place,
    tiedCount: sharing.get(place) ?? 1,
    rankedEntryCount: entries.length,
  }));
}

/** A squad's running total in a cup or a championship year. */
export interface CupTally {
  squadId: string;
  /** Tenths of a point. */
  points: number;
  /** Contests the squad won, alone or tied. */
  wins: number;
  /** Contests the squad finished 1st, 2nd or 3rd. */
  podiums: number;
}

/** A tally with its place: `position` 1 is best, shared on a tie, and `displayPosition` reads "T2" for one. */
export type Ranked<T> = T & { position: number; displayPosition: string };
export type RankedCupTally<T extends CupTally> = Ranked<T>;

/**
 * Ranks tallies best first by `compare` (negative when the left is ahead); tallies it calls equal
 * share the place. The input order breaks no tie, but is kept among tallies sharing one.
 */
export function rankTallies<T>(tallies: readonly T[], compare: (left: T, right: T) => number): Ranked<T>[] {
  const sorted = [...tallies].sort(compare);
  return sorted.map((tally) => {
    const position = 1 + sorted.filter((other) => compare(other, tally) < 0).length;
    const shared = sorted.filter((other) => compare(other, tally) === 0).length > 1;
    return { ...tally, position, displayPosition: shared ? `T${position}` : String(position) };
  });
}

/** Ranks squads in a cup: more points, then more wins, then more podiums; squads equal on all three share the place. */
export function rankCupTallies<T extends CupTally>(tallies: readonly T[]): RankedCupTally<T>[] {
  return rankTallies(tallies, (left, right) =>
    right.points - left.points || right.wins - left.wins || right.podiums - left.podiums);
}
