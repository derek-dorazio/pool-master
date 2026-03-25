/**
 * Pick'em Engine.
 *
 * Entries predict outcomes (winners, scores, H2H matchups) per period.
 * Points awarded for correct predictions. Optional confidence weighting
 * where entries assign priority weights to their picks.
 *
 * Used by: F1-5 (race winner), NASCAR-5 (H2H matchups), HR-3 (win/place/show),
 *          NCAA-5 (Sweet 16 second chance)
 */

// --- Types ---

export interface PickEmConfig {
  totalPeriods: number;
  matchupsPerPeriod: number;
  pointsPerCorrect: number;
  confidenceWeighted: boolean;
  exactOrderBonus: number;
}

export interface PickEmState {
  contestId: string;
  config: PickEmConfig;
  currentPeriod: number;
  entries: PickEmEntryState[];
}

export interface PickEmEntryState {
  entryId: string;
  picks: PickEmPick[];
  totalScore: number;
}

export interface PickEmPick {
  period: number;
  matchupIndex: number;
  predictedWinnerId: string;
  confidenceWeight?: number;
  pickedAt: Date;
  isCorrect?: boolean;
  pointsEarned?: number;
}

export interface PickEmValidation {
  valid: boolean;
  reason?: string;
}

// --- Engine ---

export class PickEmEngine {
  /**
   * Validate a set of picks for a period.
   */
  validatePeriodPicks(
    state: PickEmState,
    entryId: string,
    period: number,
    picks: Array<{ matchupIndex: number; predictedWinnerId: string; confidenceWeight?: number }>,
  ): PickEmValidation {
    if (picks.length !== state.config.matchupsPerPeriod) {
      return {
        valid: false,
        reason: `Expected ${state.config.matchupsPerPeriod} picks, got ${picks.length}`,
      };
    }

    const entry = state.entries.find((e) => e.entryId === entryId);
    const existing = entry?.picks.filter((p) => p.period === period) ?? [];
    if (existing.length > 0) {
      return { valid: false, reason: `Picks already submitted for period ${period}` };
    }

    const indices = new Set(picks.map((p) => p.matchupIndex));
    if (indices.size !== picks.length) {
      return { valid: false, reason: 'Duplicate matchup indices' };
    }

    if (state.config.confidenceWeighted) {
      const weights = picks.map((p) => p.confidenceWeight ?? 0);
      const weightSet = new Set(weights);
      if (weightSet.size !== weights.length) {
        return { valid: false, reason: 'Confidence weights must be unique' };
      }
      if (weights.some((w) => w < 1 || w > picks.length)) {
        return {
          valid: false,
          reason: `Confidence weights must be between 1 and ${picks.length}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Submit picks for a period. Returns updated state.
   */
  submitPeriodPicks(
    state: PickEmState,
    entryId: string,
    period: number,
    picks: Array<{ matchupIndex: number; predictedWinnerId: string; confidenceWeight?: number }>,
  ): PickEmState {
    const newPicks: PickEmPick[] = picks.map((p) => ({
      period,
      matchupIndex: p.matchupIndex,
      predictedWinnerId: p.predictedWinnerId,
      confidenceWeight: p.confidenceWeight,
      pickedAt: new Date(),
    }));

    const entryExists = state.entries.some((e) => e.entryId === entryId);

    const updatedEntries = entryExists
      ? state.entries.map((entry) => {
          if (entry.entryId !== entryId) return entry;
          return { ...entry, picks: [...entry.picks, ...newPicks] };
        })
      : [...state.entries, { entryId, picks: newPicks, totalScore: 0 }];

    return { ...state, entries: updatedEntries };
  }

  /**
   * Resolve a period — score picks against actual results.
   */
  resolvePeriod(
    state: PickEmState,
    period: number,
    results: Array<{ matchupIndex: number; winnerId: string }>,
  ): PickEmState {
    const resultMap = new Map(results.map((r) => [r.matchupIndex, r.winnerId]));

    const updatedEntries = state.entries.map((entry) => {
      const scoredPicks = entry.picks.map((pick) => {
        if (pick.period !== period) return pick;

        const actualWinner = resultMap.get(pick.matchupIndex);
        const isCorrect = actualWinner === pick.predictedWinnerId;

        let pointsEarned = 0;
        if (isCorrect) {
          pointsEarned = state.config.confidenceWeighted && pick.confidenceWeight
            ? pick.confidenceWeight
            : state.config.pointsPerCorrect;
        }

        return { ...pick, isCorrect, pointsEarned };
      });

      const totalScore = scoredPicks.reduce((sum, p) => sum + (p.pointsEarned ?? 0), 0);

      return { ...entry, picks: scoredPicks, totalScore };
    });

    return { ...state, entries: updatedEntries, currentPeriod: period + 1 };
  }

  /**
   * Get the leaderboard sorted by total score.
   */
  getLeaderboard(state: PickEmState): Array<{ entryId: string; totalScore: number; rank: number }> {
    const sorted = [...state.entries].sort((a, b) => b.totalScore - a.totalScore);
    return sorted.map((entry, index) => ({
      entryId: entry.entryId,
      totalScore: entry.totalScore,
      rank: index + 1,
    }));
  }
}
