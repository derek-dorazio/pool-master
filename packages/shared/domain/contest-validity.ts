import { ContestFormat, Sport, TournamentFormat } from './enums';

export const VALID_CONTEST_FORMATS_BY_TOURNAMENT_FORMAT = {
  [TournamentFormat.STROKE_PLAY_TOURNAMENT]: [ContestFormat.ROSTER],
  [TournamentFormat.KNOCKOUT_BRACKET]: [
    ContestFormat.ROSTER,
    ContestFormat.BRACKET,
  ],
  [TournamentFormat.SERIES_PLAYOFF]: [ContestFormat.ROSTER],
  [TournamentFormat.ROUND_ROBIN_SEASON]: [
    ContestFormat.PICKEM_CONFIDENCE,
    ContestFormat.SURVIVOR,
  ],
  [TournamentFormat.WEEKLY_GAMES_SEASON]: [
    ContestFormat.PICKEM_CONFIDENCE,
    ContestFormat.SURVIVOR,
  ],
  [TournamentFormat.TIME_TRIAL_RACE]: [
    ContestFormat.ROSTER,
    ContestFormat.PREDICT_TOP_N,
  ],
  [TournamentFormat.SEASON_OF_RACES]: [ContestFormat.ROSTER],
  [TournamentFormat.GROUP_STAGE_KNOCKOUT]: [
    ContestFormat.ROSTER,
    ContestFormat.BRACKET,
  ],
  [TournamentFormat.MATCH_PLAY]: [ContestFormat.ROSTER],
} as const satisfies Record<TournamentFormat, readonly ContestFormat[]>;

// Bridge for APIs/UI surfaces that only expose the legacy Sport enum while
// Phase 4 moves runtime authority to persisted Sport.tournamentFormat.
export const DEFAULT_TOURNAMENT_FORMAT_BY_SPORT = {
  [Sport.GOLF]: TournamentFormat.STROKE_PLAY_TOURNAMENT,
  [Sport.NFL]: TournamentFormat.WEEKLY_GAMES_SEASON,
  [Sport.NBA]: TournamentFormat.SERIES_PLAYOFF,
  [Sport.F1]: TournamentFormat.SEASON_OF_RACES,
  [Sport.NASCAR]: TournamentFormat.SEASON_OF_RACES,
  [Sport.NCAA_BASKETBALL]: TournamentFormat.KNOCKOUT_BRACKET,
  [Sport.NCAA_HOCKEY]: TournamentFormat.KNOCKOUT_BRACKET,
  [Sport.NCAA_FOOTBALL]: TournamentFormat.WEEKLY_GAMES_SEASON,
  [Sport.TENNIS]: TournamentFormat.KNOCKOUT_BRACKET,
  [Sport.HORSE_RACING]: TournamentFormat.TIME_TRIAL_RACE,
  [Sport.SOCCER]: TournamentFormat.GROUP_STAGE_KNOCKOUT,
  [Sport.NHL]: TournamentFormat.SERIES_PLAYOFF,
  [Sport.MLB]: TournamentFormat.SERIES_PLAYOFF,
  [Sport.UFC]: TournamentFormat.MATCH_PLAY,
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
