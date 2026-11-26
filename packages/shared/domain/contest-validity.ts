import { ContestFormat, MatchFormat, ParticipantType, SelectionType } from './enums';
import { ScoringFamily } from './sports/scoring-family';

/**
 * The match formats and participant types each scoring family plays (#2083): strokes and finishing
 * places score a whole field of individuals, and head to head scores two sides, teams or
 * individuals (tennis). A sport league's scoring family is checked against the match format of
 * each of its slot definitions, the model home of how its games are played. Every sport league is
 * added by a migration, so the reference-data test that checks each seeded league against this
 * table is its one reader; a league that no row admits fails that test.
 */
// poolmaster-allow-test-export: sport leagues are written only by migrations, so the reference-data test that checks every seeded league is the table's reader
export const LEAGUE_PLAY_BY_SCORING_FAMILY = {
  [ScoringFamily.STROKE_PLAY]: { matchFormats: [MatchFormat.FIELD], participantTypes: [ParticipantType.INDIVIDUAL] },
  [ScoringFamily.FINISH_POSITION]: { matchFormats: [MatchFormat.FIELD], participantTypes: [ParticipantType.INDIVIDUAL] },
  [ScoringFamily.HEAD_TO_HEAD]: { matchFormats: [MatchFormat.HEAD_TO_HEAD], participantTypes: [ParticipantType.TEAM, ParticipantType.INDIVIDUAL] },
} as const satisfies Record<ScoringFamily, { matchFormats: readonly MatchFormat[]; participantTypes: readonly ParticipantType[] }>;

/** Whether a sport league of this scoring family may field these participants in games of this match format. */
// poolmaster-allow-test-export: sport leagues are written only by migrations, so the reference-data test that checks every seeded league is its reader
export function isLeaguePlayValid(scoringFamily: ScoringFamily, participantType: ParticipantType, matchFormat: MatchFormat): boolean {
  const play = LEAGUE_PLAY_BY_SCORING_FAMILY[scoringFamily];
  return (play.matchFormats as readonly MatchFormat[]).includes(matchFormat)
    && (play.participantTypes as readonly ParticipantType[]).includes(participantType);
}

/**
 * The contest formats an event's games allow, by whether it plays matches (#2008): a field is
 * picked from, while games between two sides can also be predicted or played as squares.
 */
const VALID_CONTEST_FORMATS = {
  playsMatches: [ContestFormat.ROSTER, ContestFormat.PREDICTION, ContestFormat.SQUARES],
  fieldOnly: [ContestFormat.ROSTER],
} as const satisfies Record<string, readonly ContestFormat[]>;

/** Whether a contest of this format can be played on an event, by whether the event plays matches (`eventPlaysMatches`). */
export function isContestFormatValidForEvent(playsMatches: boolean, contestFormat: ContestFormat): boolean {
  return (VALID_CONTEST_FORMATS[playsMatches ? 'playsMatches' : 'fieldOnly'] as readonly ContestFormat[]).includes(contestFormat);
}

/**
 * The contest format each selection type plays (#716): a roster type picks field members, a
 * prediction type picks the winners of games, and squares (#711) claims boxes of a grid on one
 * game. A contest's two values always agree.
 */
export const CONTEST_FORMAT_BY_SELECTION_TYPE = {
  [SelectionType.TIERED]: ContestFormat.ROSTER,
  [SelectionType.BUDGET_PICK]: ContestFormat.ROSTER,
  [SelectionType.RANDOM_DRAW]: ContestFormat.ROSTER,
  [SelectionType.PICK_EM]: ContestFormat.PREDICTION,
  [SelectionType.BRACKET]: ContestFormat.PREDICTION,
  [SelectionType.SURVIVOR]: ContestFormat.PREDICTION,
  [SelectionType.SQUARES]: ContestFormat.SQUARES,
} as const satisfies Record<SelectionType, ContestFormat>;

/** The selection types that pick field members. */
export type RosterSelectionType = {
  [Type in SelectionType]: (typeof CONTEST_FORMAT_BY_SELECTION_TYPE)[Type] extends typeof ContestFormat.ROSTER ? Type : never
}[SelectionType];
/** The selection types that pick the winners of games. */
export type PredictionSelectionType = {
  [Type in SelectionType]: (typeof CONTEST_FORMAT_BY_SELECTION_TYPE)[Type] extends typeof ContestFormat.PREDICTION ? Type : never
}[SelectionType];

export function contestFormatForSelectionType(selectionType: SelectionType): ContestFormat {
  return CONTEST_FORMAT_BY_SELECTION_TYPE[selectionType];
}

export function isPredictionSelectionType(selectionType: SelectionType): selectionType is PredictionSelectionType {
  return contestFormatForSelectionType(selectionType) === ContestFormat.PREDICTION;
}

/** Whether the selection type picks a lineup from the field: neither a prediction type nor squares. */
export function isRosterSelectionType(selectionType: SelectionType): selectionType is RosterSelectionType {
  return contestFormatForSelectionType(selectionType) === ContestFormat.ROSTER;
}
