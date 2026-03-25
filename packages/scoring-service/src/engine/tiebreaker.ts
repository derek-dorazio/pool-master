/**
 * Tiebreaker Evaluation — resolves ties between contest entries
 * by walking the primary → secondary → tertiary tiebreaker chain.
 */

import type { TiebreakerConfig } from '@poolmaster/shared/domain/scoring-config';

/** Data required to evaluate tiebreakers for an entry. */
export interface TiebreakerData {
  entryId: string;
  totalScore: number;
  tiebreakerPrediction?: number;
  correctPicks?: number;
  submittedAt?: Date;
  bestSingleScore?: number;
  birdieCount?: number;
  lowestRound?: number;
  headToHeadWins?: number;
  totalWins?: number;
}

export type TiebreakerResult = -1 | 0 | 1;

/** Compare two entries on a single tiebreaker method. Returns -1, 0, or 1. */
function compareSingle(
  method: string,
  a: TiebreakerData,
  b: TiebreakerData,
  actualValue?: number,
): TiebreakerResult {
  switch (method) {
    case 'CHAMPIONSHIP_SCORE_PREDICTION': {
      if (actualValue === undefined || a.tiebreakerPrediction === undefined || b.tiebreakerPrediction === undefined) return 0;
      const diffA = Math.abs(a.tiebreakerPrediction - actualValue);
      const diffB = Math.abs(b.tiebreakerPrediction - actualValue);
      if (diffA < diffB) return -1;
      if (diffA > diffB) return 1;
      return 0;
    }

    case 'MOST_CORRECT_PICKS': {
      const aVal = a.correctPicks ?? 0;
      const bVal = b.correctPicks ?? 0;
      if (aVal > bVal) return -1;
      if (aVal < bVal) return 1;
      return 0;
    }

    case 'EARLIER_SUBMISSION': {
      if (!a.submittedAt || !b.submittedAt) return 0;
      const aTime = a.submittedAt.getTime();
      const bTime = b.submittedAt.getTime();
      if (aTime < bTime) return -1;
      if (aTime > bTime) return 1;
      return 0;
    }

    case 'BEST_SINGLE_SCORE': {
      const aVal = a.bestSingleScore ?? 0;
      const bVal = b.bestSingleScore ?? 0;
      if (aVal > bVal) return -1;
      if (aVal < bVal) return 1;
      return 0;
    }

    case 'MOST_BIRDIES': {
      const aVal = a.birdieCount ?? 0;
      const bVal = b.birdieCount ?? 0;
      if (aVal > bVal) return -1;
      if (aVal < bVal) return 1;
      return 0;
    }

    case 'LOWEST_ROUND': {
      const aVal = a.lowestRound ?? Infinity;
      const bVal = b.lowestRound ?? Infinity;
      if (aVal < bVal) return -1;
      if (aVal > bVal) return 1;
      return 0;
    }

    case 'HEAD_TO_HEAD_RECORD': {
      const aVal = a.headToHeadWins ?? 0;
      const bVal = b.headToHeadWins ?? 0;
      if (aVal > bVal) return -1;
      if (aVal < bVal) return 1;
      return 0;
    }

    case 'MOST_WINS': {
      const aVal = a.totalWins ?? 0;
      const bVal = b.totalWins ?? 0;
      if (aVal > bVal) return -1;
      if (aVal < bVal) return 1;
      return 0;
    }

    case 'COIN_FLIP':
      // Random — deterministic in tests via seed, but here just random
      return 0;

    case 'COMMISSIONER_DECISION':
      // Cannot be resolved programmatically
      return 0;

    default:
      return 0;
  }
}

/**
 * Compare two entries using the full tiebreaker chain.
 * Returns -1 if a wins, 1 if b wins, 0 if still tied.
 *
 * @param actualValue - The actual championship score (for CHAMPIONSHIP_SCORE_PREDICTION).
 */
export function evaluateTiebreaker(
  config: TiebreakerConfig,
  a: TiebreakerData,
  b: TiebreakerData,
  actualValue?: number,
): TiebreakerResult {
  const methods = [config.primary, config.secondary, config.tertiary].filter(
    (m) => m !== undefined,
  ) as string[];

  for (const method of methods) {
    const result = compareSingle(method, a, b, actualValue);
    if (result !== 0) return result;
  }

  return 0;
}

/**
 * Sort entries by score (descending) then apply tiebreaker chain.
 * Returns entries in final ranked order.
 */
export function rankWithTiebreakers(
  entries: TiebreakerData[],
  config: TiebreakerConfig | undefined,
  actualValue?: number,
): TiebreakerData[] {
  return [...entries].sort((a, b) => {
    // Primary sort: total score descending
    if (a.totalScore !== b.totalScore) {
      return b.totalScore - a.totalScore;
    }

    // Tiebreaker chain
    if (config) {
      return evaluateTiebreaker(config, a, b, actualValue);
    }

    return 0;
  });
}
