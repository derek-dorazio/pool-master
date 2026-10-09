import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/errors';
import { getLeagueLoadErrorCopy, isLeagueAccessError } from './league-load-error';

function apiError(code: string) {
  return new ApiError({ error: { code, message: `${code} from the backend` } });
}

const ACCESS_COPY = {
  title: 'You do not have access to this league.',
  body:
    'Open one of your active leagues from the header selector or return to your welcome page to continue.',
};

const GENERIC_COPY = {
  title: "We couldn't load this league.",
  body:
    'Use the league selector in the header to switch to one of your active leagues, or return to your welcome page and try again.',
};

describe('league load error helpers', () => {
  it('treats ApiErrors coded LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE as league access errors', () => {
    expect(isLeagueAccessError(apiError('LEAGUE_MEMBERSHIP_REQUIRED'))).toBe(true);
    expect(isLeagueAccessError(apiError('LEAGUE_MEMBERSHIP_INACTIVE'))).toBe(true);
  });

  it('does not treat other ApiError codes, plain Errors, or a missing error as league access errors', () => {
    expect(isLeagueAccessError(apiError('LEAGUE_NOT_FOUND'))).toBe(false);
    expect(isLeagueAccessError(new Error('LEAGUE_MEMBERSHIP_REQUIRED'))).toBe(false);
    expect(isLeagueAccessError(null)).toBe(false);
  });

  it('returns the no-access copy for a league membership error', () => {
    expect(getLeagueLoadErrorCopy(apiError('LEAGUE_MEMBERSHIP_REQUIRED'))).toEqual(ACCESS_COPY);
  });

  it('returns the generic could-not-load copy for an unexpected load failure', () => {
    expect(getLeagueLoadErrorCopy(new Error('boom'))).toEqual(GENERIC_COPY);
  });
});
