export type AuthRouteMode = 'login' | 'register';

export type ParsedRouteState = {
  from?: string;
  authMode?: AuthRouteMode;
  leagueCode?: string;
  /** Set by the invite join page when the member joined but their chosen team name and icon did not save. */
  teamSetupFailed?: boolean;
};

export function parseRouteState(value: unknown): ParsedRouteState {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const parsed: ParsedRouteState = {};

  if (typeof candidate.from === 'string') {
    parsed.from = candidate.from;
  }

  if (candidate.authMode === 'login' || candidate.authMode === 'register') {
    parsed.authMode = candidate.authMode;
  }

  if (typeof candidate.leagueCode === 'string') {
    parsed.leagueCode = candidate.leagueCode;
  }

  if (candidate.teamSetupFailed === true) {
    parsed.teamSetupFailed = true;
  }

  return parsed;
}
