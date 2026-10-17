import { ContestFormat, type Sport, TournamentFormat } from './enums';
import { getSportDefinition } from './sports/registry';

export const VALID_CONTEST_FORMATS_BY_TOURNAMENT_FORMAT = {
  [TournamentFormat.STROKE_PLAY_TOURNAMENT]: [ContestFormat.ROSTER],
  [TournamentFormat.RACE]: [ContestFormat.ROSTER],
  [TournamentFormat.KNOCKOUT_BRACKET]: [ContestFormat.ROSTER],
} as const satisfies Record<TournamentFormat, readonly ContestFormat[]>;

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
