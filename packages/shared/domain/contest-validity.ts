import { ContestFormat, ParticipantType, SelectionType, type Sport, TournamentFormat } from './enums';
import { getSportDefinition } from './sports/registry';
import { ScoringFamily } from './sports/scoring-family';

/**
 * The scoring families and participant types a sport league may pair with its sport's tournament
 * format (#2083): a stroke-play tournament is scored in strokes by individuals, a race by finishing
 * place by individuals, and matches head to head by teams or individuals (tennis). Every sport
 * league is added by a migration, so the reference-data test that checks each seeded league
 * against this table is its one reader; a league that no row admits fails that test.
 */
// poolmaster-allow-test-export: sport leagues are written only by migrations, so the reference-data test that checks every seeded league is the table's reader
export const VALID_LEAGUE_PLAY_BY_TOURNAMENT_FORMAT = {
  [TournamentFormat.STROKE_PLAY_TOURNAMENT]: { scoringFamilies: [ScoringFamily.STROKE_PLAY], participantTypes: [ParticipantType.INDIVIDUAL] },
  [TournamentFormat.RACE]: { scoringFamilies: [ScoringFamily.FINISH_POSITION], participantTypes: [ParticipantType.INDIVIDUAL] },
  [TournamentFormat.MATCHES]: { scoringFamilies: [ScoringFamily.HEAD_TO_HEAD], participantTypes: [ParticipantType.TEAM, ParticipantType.INDIVIDUAL] },
} as const satisfies Record<TournamentFormat, { scoringFamilies: readonly ScoringFamily[]; participantTypes: readonly ParticipantType[] }>;

/** Whether a sport league of this tournament format may score with this family and field these participants. */
// poolmaster-allow-test-export: sport leagues are written only by migrations, so the reference-data test that checks every seeded league is its reader
export function isLeaguePlayValidForTournamentFormat(
  tournamentFormat: TournamentFormat,
  scoringFamily: ScoringFamily,
  participantType: ParticipantType,
): boolean {
  const play = VALID_LEAGUE_PLAY_BY_TOURNAMENT_FORMAT[tournamentFormat];
  return (play.scoringFamilies as readonly ScoringFamily[]).includes(scoringFamily)
    && (play.participantTypes as readonly ParticipantType[]).includes(participantType);
}

export const VALID_CONTEST_FORMATS_BY_TOURNAMENT_FORMAT = {
  [TournamentFormat.STROKE_PLAY_TOURNAMENT]: [ContestFormat.ROSTER],
  [TournamentFormat.RACE]: [ContestFormat.ROSTER],
  [TournamentFormat.MATCHES]: [ContestFormat.ROSTER, ContestFormat.PREDICTION, ContestFormat.SQUARES],
} as const satisfies Record<TournamentFormat, readonly ContestFormat[]>;

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

export function getValidContestFormatsForTournamentFormat(
  tournamentFormat: TournamentFormat,
): readonly ContestFormat[] {
  return VALID_CONTEST_FORMATS_BY_TOURNAMENT_FORMAT[tournamentFormat];
}

export function isContestFormatValidForTournamentFormat(
  tournamentFormat: TournamentFormat,
  contestFormat: ContestFormat,
): boolean {
  return getValidContestFormatsForTournamentFormat(tournamentFormat)
    .includes(contestFormat);
}

/**
 * The tournament format a sport's events get, from its sport definition. A bridge for APIs and
 * screens that only know the sport, while the persisted `Sport.tournamentFormat` is the authority.
 */
export function getDefaultTournamentFormatForSport(sport: Sport): TournamentFormat {
  return getSportDefinition(sport).tournamentFormat;
}

export function isContestFormatValidForSport(
  sport: Sport,
  contestFormat: ContestFormat,
): boolean {
  return isContestFormatValidForTournamentFormat(
    getDefaultTournamentFormatForSport(sport),
    contestFormat,
  );
}
