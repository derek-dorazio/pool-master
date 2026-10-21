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
  PredictedChoice,
  PredictionSelectionType,
  SportEventMatch,
} from '@poolmaster/shared/domain';
import type { PickWindow } from '../../contests/entry-window';
import type { BracketScore, PredictedSides } from '../../scoring-families/head-to-head/bracket-picks';

/** What stops a week's picks being submitted. */
export const PredictionIssueKind = {
  /** A game of the week has no pick. */
  WEEK_INCOMPLETE: 'WEEK_INCOMPLETE',
  /** A confidence pool's values are not 1 to the week's game count, each used once. */
  CONFIDENCE_INVALID: 'CONFIDENCE_INVALID',
  /** No guess of the tiebreaker game's total points: a bracket's final (#721), a week's last game (#717). */
  TIEBREAKER_MISSING: 'TIEBREAKER_MISSING',
  /** A survivor week (#719) has other than one pick: the event's first round needs one, and any round holds at most one. */
  ONE_PICK_REQUIRED: 'ONE_PICK_REQUIRED',
  /** A survivor pick names a team the entry picked in another week or round. */
  TEAM_ALREADY_USED: 'TEAM_ALREADY_USED',
  /** A survivor entry is out, so it plays no later week. */
  ENTRY_ELIMINATED: 'ENTRY_ELIMINATED',
} as const;
export type PredictionIssueKind = (typeof PredictionIssueKind)[keyof typeof PredictionIssueKind];

export type PredictionIssue =
  | { kind: typeof PredictionIssueKind.WEEK_INCOMPLETE; pickedCount: number; gameCount: number }
  | { kind: typeof PredictionIssueKind.CONFIDENCE_INVALID }
  | { kind: typeof PredictionIssueKind.TIEBREAKER_MISSING }
  | { kind: typeof PredictionIssueKind.ONE_PICK_REQUIRED; pickedCount: number }
  | { kind: typeof PredictionIssueKind.TEAM_ALREADY_USED; sportEventParticipantId: string }
  | { kind: typeof PredictionIssueKind.ENTRY_ELIMINATED };

/**
 * What the entry's earlier weeks leave it for this one (#719): the teams it has used, by
 * participant, and whether it is already out. Read only for an engine that `readsEarlierWeeks`.
 */
export interface PredictionSeason {
  /** The teams, by participant, the entry picked in the other events it submitted. This event's own rounds are read from its picks. */
  usedParticipantIds: ReadonlySet<string>;
  /** The week number (1 for the contest's first week) that put the entry out; null while it stands. */
  eliminatedInWeek: number | null;
  /** Each field row of this week's event, by id, to its participant. */
  participantIdOf: ReadonlyMap<string, string>;
  /** Each game of the event, by match id, to its round: a playoff's rounds are each a week (#785). */
  roundOf: ReadonlyMap<string, number>;
  /** The event's first round, whose pick submitting the event needs. */
  firstRoundNumber: number;
  /** Each of the event's rounds to its week number in the contest. */
  weekNumberOfRound: ReadonlyMap<number, number>;
  /** The week number of the event's first round. */
  firstWeekNumber: number;
}

/** One pick as the week's rules read it: a team, or a tie (#792). */
export type WeekPrediction = PredictedChoice & {
  sportEventMatchId: string;
  confidence: number | null;
};

/** Each game's teams the entry may pick, by match id, and which of its picks stand. */
export interface ResolvedPicks<Pick extends WeekPrediction> {
  sides: Map<string, PredictedSides>;
  /** The picks that stand. */
  kept: Pick[];
  /** The picks that do not: a team its game does not offer the entry, or a tie where the engine takes none. */
  stranded: Pick[];
}

/** How an entry's picks score against the results so far: its points and each pick's outcome. */
export type PicksScore = BracketScore;

export interface PredictionEngine {
  readonly selectionType: PredictionSelectionType;
  /** When a pick closes and is revealed to the league: at its game's kickoff, or at the event's start. */
  readonly pickWindow: PickWindow;
  /** One pick per round of the event (survivor: a week, or a playoff round) rather than one per game: a new pick replaces the entry's other one in its round. */
  readonly onePickPerRound: boolean;
  /** Whether the week's rules read the entry's earlier weeks of the contest (survivor's used teams and elimination). */
  readonly readsEarlierWeeks: boolean;
  /**
   * Whether a pick may say a game ends level (#792): pick'em, where the sport offers tie picks
   * (`SportPickEm.tiePicks`). A bracket and a survivor pick always name a team.
   */
  readonly takesTiePicks: boolean;

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
    /** The field rows withdrawn after the draw (#704), out of their games. */
    withdrawn: ReadonlySet<string>;
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
    withdrawn: ReadonlySet<string>;
    scoring: ContestScoringSettings | null;
  }): PicksScore | null;

  /** Everything that stops the week being submitted, empty when it may be. */
  findWeekIssues(input: {
    configuration: ContestSelectionConfig | undefined;
    gameMatchIds: readonly string[];
    predictions: readonly WeekPrediction[];
    tiebreakerValue: number | null;
    /** The entry's other weeks; null or left out for an engine that does not read them. */
    season?: PredictionSeason | null;
  }): PredictionIssue[];
}
