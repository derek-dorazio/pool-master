import { ApiError } from '@/lib/errors';

const LEAGUE_ACCESS_ERROR_CODES: ReadonlySet<string> = new Set([
  'LEAGUE_MEMBERSHIP_REQUIRED',
  'LEAGUE_MEMBERSHIP_INACTIVE',
]);

export function isLeagueAccessError(error: Error | null | undefined) {
  return error instanceof ApiError
    && error.code !== undefined
    && LEAGUE_ACCESS_ERROR_CODES.has(error.code);
}

export function getLeagueLoadErrorCopy(error: Error | null | undefined) {
  if (isLeagueAccessError(error)) {
    return {
      title: 'You do not have access to this league.',
      body:
        'Open one of your active leagues from the header selector or return to your welcome page to continue.',
    };
  }

  return {
    title: "We couldn't load this league.",
    body:
      'Use the league selector in the header to switch to one of your active leagues, or return to your welcome page and try again.',
  };
}
