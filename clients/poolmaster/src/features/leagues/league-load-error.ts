type LeagueLoadErrorCandidate = {
  code?: unknown;
  message?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
  };
};

function getErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as LeagueLoadErrorCandidate;
  if (typeof candidate.error?.code === 'string') {
    return candidate.error.code;
  }

  if (typeof candidate.code === 'string') {
    return candidate.code;
  }

  return null;
}

export function isLeagueAccessError(error: unknown) {
  const code = getErrorCode(error);
  return code === 'LEAGUE_MEMBERSHIP_REQUIRED' || code === 'LEAGUE_MEMBERSHIP_INACTIVE';
}

export function getLeagueLoadErrorCopy(error: unknown) {
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
