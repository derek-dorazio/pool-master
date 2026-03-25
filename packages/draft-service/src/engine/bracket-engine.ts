/**
 * Bracket Pick'em Engine.
 *
 * Entries submit a full bracket prediction before the tournament begins.
 * Points awarded per correct prediction, with round multipliers that
 * increase in later rounds. Optional series length bonus.
 *
 * Used by: NBA-3 (playoffs bracket), NHL-3 (Stanley Cup bracket),
 *          MLB-3 (HR Derby bracket), NCAA-5 (Sweet 16), SOC-4 (World Cup)
 */

// --- Types ---

export interface BracketConfig {
  totalRounds: number;
  roundValues: number[];
  seriesLengthBonus: number;
  correctScoreBonus: number;
  tiebreakerRule?: string;
}

export interface BracketState {
  contestId: string;
  config: BracketConfig;
  entries: BracketEntryState[];
}

export interface BracketEntryState {
  entryId: string;
  predictions: MatchPrediction[];
  submittedAt: Date;
  tiebreakerValue?: number;
  totalScore: number;
}

export interface MatchPrediction {
  roundNumber: number;
  matchNumber: number;
  predictedWinnerId: string;
  predictedSeriesLength?: number;
  predictedScore?: string;
  isCorrect?: boolean;
  pointsEarned?: number;
}

export interface MatchResult {
  roundNumber: number;
  matchNumber: number;
  winnerId: string;
  seriesLength?: number;
  score?: string;
}

export interface BracketValidation {
  valid: boolean;
  reason?: string;
}

// --- Engine ---

export class BracketEngine {
  /**
   * Validate a bracket submission.
   */
  validateBracket(
    state: BracketState,
    entryId: string,
    predictions: MatchPrediction[],
  ): BracketValidation {
    const existing = state.entries.find((e) => e.entryId === entryId);
    if (existing) {
      return { valid: false, reason: 'Bracket already submitted' };
    }

    if (predictions.length === 0) {
      return { valid: false, reason: 'No predictions provided' };
    }

    const keys = new Set(predictions.map((p) => `${p.roundNumber}-${p.matchNumber}`));
    if (keys.size !== predictions.length) {
      return { valid: false, reason: 'Duplicate match predictions' };
    }

    for (const pred of predictions) {
      if (pred.roundNumber < 1 || pred.roundNumber > state.config.totalRounds) {
        return { valid: false, reason: `Invalid round number: ${pred.roundNumber}` };
      }
    }

    return { valid: true };
  }

  /**
   * Submit a full bracket prediction. Returns updated state.
   */
  submitBracket(
    state: BracketState,
    entryId: string,
    predictions: MatchPrediction[],
    tiebreakerValue?: number,
  ): BracketState {
    const newEntry: BracketEntryState = {
      entryId,
      predictions,
      submittedAt: new Date(),
      tiebreakerValue,
      totalScore: 0,
    };

    return { ...state, entries: [...state.entries, newEntry] };
  }

  /**
   * Score all brackets against actual results for a round.
   */
  scoreRound(
    state: BracketState,
    roundNumber: number,
    results: MatchResult[],
  ): BracketState {
    const roundValue = state.config.roundValues[roundNumber - 1] ?? 1;
    const resultMap = new Map(
      results.map((r) => [`${r.roundNumber}-${r.matchNumber}`, r]),
    );

    const updatedEntries = state.entries.map((entry) => {
      const scoredPredictions = entry.predictions.map((pred) => {
        if (pred.roundNumber !== roundNumber) return pred;

        const key = `${pred.roundNumber}-${pred.matchNumber}`;
        const result = resultMap.get(key);

        if (!result) return pred;

        const isCorrect = pred.predictedWinnerId === result.winnerId;
        let pointsEarned = 0;

        if (isCorrect) {
          pointsEarned = roundValue;

          if (
            state.config.seriesLengthBonus > 0 &&
            pred.predictedSeriesLength != null &&
            result.seriesLength != null &&
            pred.predictedSeriesLength === result.seriesLength
          ) {
            pointsEarned += state.config.seriesLengthBonus;
          }

          if (
            state.config.correctScoreBonus > 0 &&
            pred.predictedScore != null &&
            result.score != null &&
            pred.predictedScore === result.score
          ) {
            pointsEarned += state.config.correctScoreBonus;
          }
        }

        return { ...pred, isCorrect, pointsEarned };
      });

      const totalScore = scoredPredictions.reduce(
        (sum, p) => sum + (p.pointsEarned ?? 0),
        0,
      );

      return { ...entry, predictions: scoredPredictions, totalScore };
    });

    return { ...state, entries: updatedEntries };
  }

  /**
   * Get the leaderboard. Ties broken by tiebreaker value proximity.
   */
  getLeaderboard(
    state: BracketState,
    actualTiebreakerValue?: number,
  ): Array<{ entryId: string; totalScore: number; rank: number }> {
    const sorted = [...state.entries].sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;

      if (actualTiebreakerValue != null) {
        const aDiff = Math.abs((a.tiebreakerValue ?? 0) - actualTiebreakerValue);
        const bDiff = Math.abs((b.tiebreakerValue ?? 0) - actualTiebreakerValue);
        return aDiff - bDiff;
      }

      return 0;
    });

    return sorted.map((entry, index) => ({
      entryId: entry.entryId,
      totalScore: entry.totalScore,
      rank: index + 1,
    }));
  }

  /**
   * Get scoring summary per entry — correct/total by round.
   */
  getEntrySummary(
    state: BracketState,
    entryId: string,
  ): Array<{ roundNumber: number; correct: number; total: number; points: number }> {
    const entry = state.entries.find((e) => e.entryId === entryId);
    if (!entry) return [];

    const byRound = new Map<number, { correct: number; total: number; points: number }>();

    for (const pred of entry.predictions) {
      const existing = byRound.get(pred.roundNumber) ?? { correct: 0, total: 0, points: 0 };
      existing.total++;
      if (pred.isCorrect) existing.correct++;
      existing.points += pred.pointsEarned ?? 0;
      byRound.set(pred.roundNumber, existing);
    }

    return Array.from(byRound.entries())
      .sort(([a], [b]) => a - b)
      .map(([roundNumber, data]) => ({ roundNumber, ...data }));
  }
}
