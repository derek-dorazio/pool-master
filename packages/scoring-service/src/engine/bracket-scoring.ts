/**
 * Bracket Scoring Engine — evaluates bracket predictions against actual results.
 *
 * Supports:
 * - Round-based points (e.g. 1-2-4-8-16-32)
 * - Upset bonus: SEED_DIFFERENCE (bonus = winner_seed - loser_seed)
 * - Seed multiplier: SEED_MULTIPLIER (points = round_value × winning_seed)
 * - Tiebreaker via championship score prediction
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

/** A single match result in the bracket. */
export interface BracketMatchResult {
  roundNumber: number;
  matchNumber: number;
  winnerId: string;
  winnerSeed?: number;
  loserSeed?: number;
  actualScore?: string;
}

/** A single prediction from an entry. */
export interface BracketPredictionInput {
  roundNumber: number;
  matchNumber: number;
  predictedWinnerId: string;
  predictedSeriesLength?: number;
  predictedScore?: string;
}

/** Score breakdown for a single correct/incorrect pick. */
export interface BracketPickResult {
  roundNumber: number;
  matchNumber: number;
  isCorrect: boolean;
  basePoints: number;
  upsetBonus: number;
  totalPoints: number;
}

/** Full result for scoring one entry's bracket. */
export interface BracketEntryResult {
  totalScore: number;
  correctPicks: number;
  totalPicks: number;
  pickResults: BracketPickResult[];
}

/**
 * Score a bracket entry's predictions against actual results.
 */
export function scoreBracket(
  config: ScoringConfig,
  predictions: BracketPredictionInput[],
  results: BracketMatchResult[],
): BracketEntryResult {
  const roundRules = config.bracket_round_rules;
  const upsetConfig = config.upset_bonus_config;

  // Index results by round+match for fast lookup
  const resultMap = new Map<string, BracketMatchResult>();
  for (const r of results) {
    resultMap.set(`${r.roundNumber}-${r.matchNumber}`, r);
  }

  const pickResults: BracketPickResult[] = [];
  let totalScore = 0;
  let correctPicks = 0;

  for (const prediction of predictions) {
    const key = `${prediction.roundNumber}-${prediction.matchNumber}`;
    const result = resultMap.get(key);

    if (!result) {
      // Match hasn't been played yet — no points
      pickResults.push({
        roundNumber: prediction.roundNumber,
        matchNumber: prediction.matchNumber,
        isCorrect: false,
        basePoints: 0,
        upsetBonus: 0,
        totalPoints: 0,
      });
      continue;
    }

    const isCorrect = prediction.predictedWinnerId === result.winnerId;

    if (!isCorrect) {
      pickResults.push({
        roundNumber: prediction.roundNumber,
        matchNumber: prediction.matchNumber,
        isCorrect: false,
        basePoints: 0,
        upsetBonus: 0,
        totalPoints: 0,
      });
      continue;
    }

    // Find round rule
    const roundRule = roundRules.find((r) => r.round === prediction.roundNumber);
    let basePoints = roundRule?.points_per_correct ?? 0;

    // Apply upset bonus
    let upsetBonus = 0;
    if (upsetConfig && result.winnerSeed !== undefined && result.loserSeed !== undefined) {
      const isUpset = result.winnerSeed > result.loserSeed;

      if (upsetConfig.type === 'SEED_DIFFERENCE' && isUpset) {
        upsetBonus = result.winnerSeed - result.loserSeed;
        if (upsetConfig.apply_round_multiplier && roundRule) {
          upsetBonus *= roundRule.points_per_correct;
        }
      } else if (upsetConfig.type === 'SEED_MULTIPLIER') {
        // Points = round_value × winning_seed
        basePoints = roundRule ? roundRule.points_per_correct * result.winnerSeed : 0;
      }
    }

    const pickTotal = basePoints + upsetBonus;
    totalScore += pickTotal;
    correctPicks++;

    pickResults.push({
      roundNumber: prediction.roundNumber,
      matchNumber: prediction.matchNumber,
      isCorrect: true,
      basePoints,
      upsetBonus,
      totalPoints: pickTotal,
    });
  }

  return {
    totalScore,
    correctPicks,
    totalPicks: predictions.length,
    pickResults,
  };
}
