/**
 * Where a match is within its event (#2161): its round, and its number within that round. Two
 * rounds each have a match 1, so a match number alone never names a match.
 */
export interface MatchPlace {
  roundNumber: number;
  matchNumber: number;
}

/** A match's place, from anything that carries both numbers (a route's params, a match). */
export function matchPlaceOf(of: MatchPlace): MatchPlace {
  return { roundNumber: of.roundNumber, matchNumber: of.matchNumber };
}

/** Whether a match is at a place. */
export function isAtPlace(match: MatchPlace, place: MatchPlace): boolean {
  return match.roundNumber === place.roundNumber && match.matchNumber === place.matchNumber;
}

/** Round first, then match number: the order a bracket and a week list their matches in. */
export function compareMatchPlaces(a: MatchPlace, b: MatchPlace): number {
  return a.roundNumber - b.roundNumber || a.matchNumber - b.matchNumber;
}

/** "round 2 match 1": a match's place, as problems and logs name it; "Round 2 match 1" to start a sentence. */
export function describeMatchPlace(place: MatchPlace, options: { sentenceStart?: boolean } = {}): string {
  return `${options.sentenceStart === true ? 'Round' : 'round'} ${String(place.roundNumber)} match ${String(place.matchNumber)}`;
}

/** Values found by a match's place: a map of rounds, each a map of its match numbers. */
export class MatchPlaceMap<V> {
  private readonly rounds = new Map<number, Map<number, V>>();

  constructor(entries: Iterable<readonly [MatchPlace, V]> = []) {
    for (const [place, value] of entries) this.set(place, value);
  }

  get(place: MatchPlace): V | undefined {
    return this.rounds.get(place.roundNumber)?.get(place.matchNumber);
  }

  has(place: MatchPlace): boolean {
    return this.rounds.get(place.roundNumber)?.has(place.matchNumber) ?? false;
  }

  set(place: MatchPlace, value: V): void {
    const round = this.rounds.get(place.roundNumber) ?? new Map<number, V>();
    round.set(place.matchNumber, value);
    this.rounds.set(place.roundNumber, round);
  }
}
