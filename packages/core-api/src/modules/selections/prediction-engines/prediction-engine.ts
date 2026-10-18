/**
 * The prediction-engine seam (#716): what differs between the selection types of a PREDICTION
 * contest, whose entries pick the winners of an event's games instead of a lineup.
 *
 * `PredictionService` is the one shared handler. It owns what every prediction type does the same
 * way: auth and entry ownership, which games an event has, that a pick names a team in its game,
 * the week's draft and submitted status, and persistence. An engine supplies its pick window and
 * the rules on the values a pick carries and on a week that may be submitted.
 */

import type { ContestSelectionConfig, PredictionSelectionType } from '@poolmaster/shared/domain';
import type { PickWindow } from '../../contests/entry-window';

/** What stops a week's picks being submitted. */
export const PredictionIssueKind = {
  /** A game of the week has no pick. */
  WEEK_INCOMPLETE: 'WEEK_INCOMPLETE',
  /** A confidence pool's values are not 1 to the week's game count, each used once. */
  CONFIDENCE_INVALID: 'CONFIDENCE_INVALID',
} as const;
export type PredictionIssueKind = (typeof PredictionIssueKind)[keyof typeof PredictionIssueKind];

export type PredictionIssue =
  | { kind: typeof PredictionIssueKind.WEEK_INCOMPLETE; pickedCount: number; gameCount: number }
  | { kind: typeof PredictionIssueKind.CONFIDENCE_INVALID };

/** One pick as the week's rules read it. */
export interface WeekPrediction {
  sportEventMatchId: string;
  confidence: number | null;
}

export interface PredictionEngine {
  readonly selectionType: PredictionSelectionType;
  /** When a pick closes and is revealed to the league: at its game's kickoff, or at the event's start. */
  readonly pickWindow: PickWindow;

  /**
   * Whether one pick may carry `confidence` in a week of `gameCount` games: null or a value the
   * contest's rules allow. Saving a pick is refused otherwise; a repeated value is allowed until
   * submit, so values can be swapped one pick at a time.
   */
  acceptsConfidence(input: {
    configuration: ContestSelectionConfig | undefined;
    confidence: number | null;
    gameCount: number;
  }): boolean;

  /** Everything that stops the week being submitted, empty when it may be. */
  findWeekIssues(input: {
    configuration: ContestSelectionConfig | undefined;
    gameMatchIds: readonly string[];
    predictions: readonly WeekPrediction[];
  }): PredictionIssue[];
}
