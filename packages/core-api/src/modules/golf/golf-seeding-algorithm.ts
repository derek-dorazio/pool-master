/**
 * golf-seeding-algorithm.ts — pure, I/O-free derivation used at field-seed
 * time (deriveSeedNumbersAndOdds) and by the separate, later price-assign
 * action (deriveGolfPrices). Both are deliberately simple first-pass
 * placeholders with no real market-odds signal to draw on yet (plans/124
 * §4.7/§4.7a). deriveGolfTournamentRounds is a later addition to this same
 * file (plans/124 §4.10) — not part of this slice.
 */

export interface SeedingRosterEntry {
  participantId: string;
  worldRanking: number | null;
}

export interface SeededParticipant {
  participantId: string;
  worldRanking: number | null;
  seedNumber: number;
  oddsToWin: number;
}

export interface PricingFieldEntry {
  participantId: string;
  seedNumber: number;
}

export interface PricedParticipant {
  participantId: string;
  seedNumber: number;
  price: number;
}

const ODDS_JITTER_RANGE = 0.3;
const ODDS_JITTER_OFFSET = 0.15;

/**
 * Sorts the roster by worldRanking ascending (nulls last), shuffling ties
 * with `random` so seeds never repeat even when world rankings do. Position
 * (1..N) becomes seedNumber directly. oddsToWin is derived from position
 * (not the raw, tie-having worldRanking) via an inverse-weighted,
 * jitter-randomized probability distribution normalized across the field.
 */
export function deriveSeedNumbersAndOdds(
  roster: SeedingRosterEntry[],
  random: () => number = Math.random,
): SeededParticipant[] {
  const ordered = tieBreakByWorldRanking(roster, random);

  const weights = ordered.map((_, index) => {
    const position = index + 1;
    const jitter = 1 + (random() * ODDS_JITTER_RANGE - ODDS_JITTER_OFFSET);
    return (1 / position) * jitter;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  return ordered.map((entry, index) => {
    const probability = weights[index] / totalWeight;
    return {
      participantId: entry.participantId,
      worldRanking: entry.worldRanking,
      seedNumber: index + 1,
      oddsToWin: roundToCents(1 / probability),
    };
  });
}

/**
 * Uses the field's already-assigned seedNumber as position — no re-sort, the
 * tie-break happened once at seed time. Min-max normalizes an inverse-weighted,
 * freshly-jittered distribution into [minPrice, maxPrice] (plans/124 §4.7a).
 */
export function deriveGolfPrices(
  field: PricingFieldEntry[],
  minPrice: number,
  maxPrice: number,
  random: () => number = Math.random,
): PricedParticipant[] {
  if (field.length === 0) {
    return [];
  }

  const ordered = [...field].sort((left, right) => left.seedNumber - right.seedNumber);
  const scores = ordered.map((entry) => {
    const jitter = 1 + (random() * ODDS_JITTER_RANGE - ODDS_JITTER_OFFSET);
    return (1 / entry.seedNumber) * jitter;
  });
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;

  return ordered.map((entry, index) => {
    const proportion = range === 0 ? 1 : (scores[index] - min) / range;
    return {
      participantId: entry.participantId,
      seedNumber: entry.seedNumber,
      price: roundToCents(minPrice + proportion * (maxPrice - minPrice)),
    };
  });
}

function tieBreakByWorldRanking(
  roster: SeedingRosterEntry[],
  random: () => number,
): SeedingRosterEntry[] {
  const groups = new Map<number | null, SeedingRosterEntry[]>();
  for (const entry of roster) {
    const key = entry.worldRanking;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const rankedKeys = Array.from(groups.keys())
    .filter((key): key is number => key !== null)
    .sort((left, right) => left - right);
  const orderedKeys = [...rankedKeys, ...(groups.has(null) ? [null] : [])];

  return orderedKeys.flatMap((key) => shuffle(groups.get(key) ?? [], random));
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}
