import { ContestFormat, Sport, TournamentFormat } from './enums';

export const VALID_CONTEST_FORMATS_BY_TOURNAMENT_FORMAT = {
  [TournamentFormat.STROKE_PLAY_TOURNAMENT]: [ContestFormat.ROSTER],
} as const satisfies Record<TournamentFormat, readonly ContestFormat[]>;

// Bridge for APIs/UI surfaces that only expose the Sport enum while runtime
// authority sits on the persisted Sport.tournamentFormat.
export const DEFAULT_TOURNAMENT_FORMAT_BY_SPORT = {
  [Sport.GOLF]: TournamentFormat.STROKE_PLAY_TOURNAMENT,
} as const satisfies Record<Sport, TournamentFormat>;

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

export function getDefaultTournamentFormatForSport(sport: Sport): TournamentFormat {
  return DEFAULT_TOURNAMENT_FORMAT_BY_SPORT[sport];
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
