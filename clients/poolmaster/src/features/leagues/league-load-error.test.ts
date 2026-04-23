import { describe, expect, it } from 'vitest';
import { getLeagueLoadErrorCopy, isLeagueAccessError } from './league-load-error';

describe('league load error helpers', () => {
  it('detects league membership access errors', () => {
    expect(
      isLeagueAccessError({
        error: {
          code: 'LEAGUE_MEMBERSHIP_REQUIRED',
        },
      }),
    ).toBe(true);

    expect(
      isLeagueAccessError({
        code: 'LEAGUE_MEMBERSHIP_INACTIVE',
      }),
    ).toBe(true);
  });

  it('returns access-state copy for membership errors', () => {
    expect(
      getLeagueLoadErrorCopy({
        error: {
          code: 'LEAGUE_MEMBERSHIP_REQUIRED',
        },
      }),
    ).toEqual({
      title: 'You do not have access to this league.',
      body:
        'Open one of your active leagues from the header selector or return to your welcome page to continue.',
    });
  });

  it('returns generic copy for unexpected load failures', () => {
    expect(getLeagueLoadErrorCopy(new Error('boom'))).toEqual({
      title: "We couldn't load this league.",
      body:
        'Use the league selector in the header to switch to one of your active leagues, or return to your welcome page and try again.',
    });
  });
});
