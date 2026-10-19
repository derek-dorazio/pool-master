/**
 * The prediction-engine seam (#716): what differs between the selection types of a PREDICTION
 * contest, whose entries pick the winners of an event's games instead of a lineup.
 *
 * `PredictionService` is the one shared handler. It owns what every prediction type does the same
 * way: auth and entry ownership, which games an event has, that a pick names a team in its game,
 * the week's draft and submitted status, and persistence. An engine supplies its pick window, which
 * teams each game offers the entry, the rules on the values a pick carries, and on a week that may
 * be submitted.
 */

import type {
  ContestScoringSettings,
  ContestSelectionConfig,
  PredictionSelectionType,
  SportEventMatch,
} from '@poolmaster/shared/domain';
import type { PickWindow } from '../../contests/entry-window';
import type { BracketScore, ResolvedBracket } from '../../scoring-families/head-to-head/bracket-picks';

/** What stops a week's picks being submitted. */
export const PredictionIssueKind = {
  /** A game of the week has no pick. */
  WEEK_INCOMPLETE: 'WEEK_INCOMPLETE',
  /** A confidence pool's values are not 1 to the week's game count, each used once. */
  CONFIDENCE_INVALID: 'CONFIDENCE_INVALID',
  /** No guess of the tiebreaker game's total points: a bracket's final (#721), a week's last game (#717). */
  TIEBREAKER_MISSING: 'TIEBREAKER_MISSING',
} as const;
export type PredictionIssueKind = (typeof PredictionIssueKind)[keyof typeof PredictionIssueKind];

export type PredictionIssue =
  | { kind: typeof PredictionIssueKind.WEEK_INCOMPLETE; pickedCount: number; gameCount: number }
  | { kind: typeof PredictionIssueKind.CONFIDENCE_INVALID }
  | { kind: typeof PredictionIssueKind.TIEBREAKER_MISSING };

/** One pick as the week's rules read it. */
export interface WeekPrediction {
  sportEventMatchId: string;
  sportEventParticipantId: string;
  confidence: number | null;
}

/** Each game's teams the entry may pick, by match id, and which of its picks stand. */
export type ResolvedPicks<Pick extends WeekPrediction> = ResolvedBracket<Pick>;

/** How an entry's picks score against the results so far: its points and each pick's outcome. */
export type PicksScore = BracketScore;

export interface PredictionEngine {
  readonly selectionType: PredictionSelectionType;
  /** When a pick closes and is revealed to the league: at its game's kickoff, or at the event's start. */
  readonly pickWindow: PickWindow;

  /**
   * The game whose total points the entry's tiebreaker guesses (#717): a bracket's final, a week's
   * last game by kickoff; null while there is none. The tiebreaker locks, and is revealed, with
   * that game's pick, and every entry gives one to submit.
   */
  tiebreakerGame(input: { games: readonly SportEventMatch[]; eventStart: Date }): SportEventMatch | null;

  /**
   * The teams each game offers the entry, and which of its picks stand: the game's own two teams
   * in a weekly pool, the entry's earlier picks in a bracket. A pick that does not stand is cleared
   * when it was already saved, and refused when it is being saved.
   */
  resolvePicks<Pick extends WeekPrediction>(input: {
    games: readonly SportEventMatch[];
    predictions: readonly Pick[];
    seedOf: ReadonlyMap<string, number | null>;
  }): ResolvedPicks<Pick>;

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

  /**
   * How the entry's standing picks score against the games' results so far, under the contest's
   * rules and scoring; null where they cannot score it.
   */
  scorePicks(input: {
    configuration: ContestSelectionConfig | undefined;
    games: readonly SportEventMatch[];
    predictions: readonly WeekPrediction[];
    seedOf: ReadonlyMap<string, number | null>;
    scoring: ContestScoringSettings | null;
  }): PicksScore | null;

  /** Everything that stops the week being submitted, empty when it may be. */
  findWeekIssues(input: {
    configuration: ContestSelectionConfig | undefined;
    gameMatchIds: readonly string[];
    predictions: readonly WeekPrediction[];
    tiebreakerValue: number | null;
  }): PredictionIssue[];
}
