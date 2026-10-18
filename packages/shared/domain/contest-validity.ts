import { ContestFormat, SelectionType, type Sport, TournamentFormat } from './enums';
import { getSportDefinition } from './sports/registry';

export const VALID_CONTEST_FORMATS_BY_TOURNAMENT_FORMAT = {
  [TournamentFormat.STROKE_PLAY_TOURNAMENT]: [ContestFormat.ROSTER],
  [TournamentFormat.RACE]: [ContestFormat.ROSTER],
  [TournamentFormat.KNOCKOUT_BRACKET]: [ContestFormat.ROSTER, ContestFormat.PREDICTION],
} as const satisfies Record<TournamentFormat, readonly ContestFormat[]>;

/**
 * The contest format each selection type plays (#716): a roster type picks field members, a
 * prediction type picks the winners of games. A contest's two values always agree.
 */
export const CONTEST_FORMAT_BY_SELECTION_TYPE = {
  [SelectionType.TIERED]: ContestFormat.ROSTER,
  [SelectionType.BUDGET_PICK]: ContestFormat.ROSTER,
  [SelectionType.RANDOM_DRAW]: ContestFormat.ROSTER,
  [SelectionType.PICK_EM]: ContestFormat.PREDICTION,
  [SelectionType.BRACKET]: ContestFormat.PREDICTION,
} as const satisfies Record<SelectionType, ContestFormat>;

/** The selection types that pick field members. */
export type RosterSelectionType = {
  [Type in SelectionType]: (typeof CONTEST_FORMAT_BY_SELECTION_TYPE)[Type] extends typeof ContestFormat.ROSTER ? Type : never
}[SelectionType];
/** The selection types that pick the winners of games. */
export type PredictionSelectionType = Exclude<SelectionType, RosterSelectionType>;

export function contestFormatForSelectionType(selectionType: SelectionType): ContestFormat {
  return CONTEST_FORMAT_BY_SELECTION_TYPE[selectionType];
}

export function isPredictionSelectionType(selectionType: SelectionType): selectionType is PredictionSelectionType {
  return contestFormatForSelectionType(selectionType) === ContestFormat.PREDICTION;
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
