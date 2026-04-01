/**
 * Stroke Play Scoring Engine — lower combined strokes wins.
 *
 * Used for golf office pools. Each participant has a stroke total.
 * Missed cut = penalty score (e.g. 80 per missed round).
 * Best-N counting: "Pick 6, Use 4" — only the best N scores count.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';
import { DNFHandling, CountingMethod } from '@poolmaster/shared/domain/scoring-config';

/** Stroke data for a single participant across rounds. */
export interface StrokePlayParticipant {
  participantId: string;
  roundStrokes: number[];          // strokes per round played (e.g. [72, 71, 69, 70])
  madecut: boolean;
  withdrew: boolean;
  totalRounds: number;             // total rounds in the tournament (typically 4)
}

/** Score breakdown for a single participant. */
export interface StrokePlayResult {
  participantId: string;
  roundStrokes: number[];          // actual or penalty-adjusted strokes per round
  totalStrokes: number;
  missedCutRounds: number;
  excluded: boolean;
}

/** Full entry result for a stroke play contest. */
export interface StrokePlayEntryResult {
  totalStrokes: number;
  countingParticipants: StrokePlayResult[];
  allParticipants: StrokePlayResult[];
}

/**
 * Score a single participant in stroke play.
 * Handles missed cut by applying penalty score for unplayed rounds.
 */
export function scoreStrokePlayParticipant(
  participant: StrokePlayParticipant,
  missedCutScore: number,
  dnfHandling: string,
): StrokePlayResult {
  const roundStrokes = [...participant.roundStrokes];
  let missedCutRounds = 0;

  if (!participant.madecut || participant.withdrew) {
    // Fill in penalty scores for unplayed rounds
    const roundsPlayed = participant.roundStrokes.length;
    const roundsMissed = participant.totalRounds - roundsPlayed;
    missedCutRounds = roundsMissed;

    if (dnfHandling === DNFHandling.enum.MISSED_CUT_SCORE) {
      for (let i = 0; i < roundsMissed; i++) {
        roundStrokes.push(missedCutScore);
      }
    } else if (dnfHandling === DNFHandling.enum.EXCLUDE) {
      return {
        participantId: participant.participantId,
        roundStrokes,
        totalStrokes: 0,
        missedCutRounds,
        excluded: true,
      };
    }
    // ZERO, PENALTY, LAST_PLACE: no additional strokes
  }

  const totalStrokes = roundStrokes.reduce((sum, s) => sum + s, 0);

  return {
    participantId: participant.participantId,
    roundStrokes,
    totalStrokes,
    missedCutRounds,
    excluded: false,
  };
}

/**
 * Score a full entry's roster in stroke play with Best-N counting.
 */
export function scoreStrokePlayEntry(
  config: ScoringConfig,
  participants: StrokePlayParticipant[],
): StrokePlayEntryResult {
  const missedCutScore = config.missed_event_score ?? 80;

  const allResults = participants.map((p) =>
    scoreStrokePlayParticipant(p, missedCutScore, config.dnf_handling),
  );

  // Filter excluded
  const eligible = allResults.filter((r) => !r.excluded);

  // Sort ascending (lowest strokes = best)
  const sorted = [...eligible].sort((a, b) => a.totalStrokes - b.totalStrokes);

  // Apply counting method
  let counting: StrokePlayResult[];
  if (config.counting_method === CountingMethod.enum.BEST_N && config.best_n !== undefined) {
    counting = sorted.slice(0, config.best_n);
  } else if (config.counting_method === CountingMethod.enum.DROP_LOWEST_N && config.drop_lowest_n !== undefined) {
    // Drop worst N (highest stroke totals)
    counting = sorted.slice(0, sorted.length - config.drop_lowest_n);
  } else {
    counting = sorted;
  }

  const totalStrokes = counting.reduce((sum, r) => sum + r.totalStrokes, 0);

  return {
    totalStrokes,
    countingParticipants: counting,
    allParticipants: allResults,
  };
}
