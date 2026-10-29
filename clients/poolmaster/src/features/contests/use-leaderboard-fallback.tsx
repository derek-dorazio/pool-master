import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, type ReactElement } from 'react';
import { ErrorState, LoadingState } from '@/features/shared/ui';
import { ApiError, extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { LEADERBOARD_ERROR_MESSAGES } from './contest-leaderboard';

/**
 * What a board shows while its read loads or after it fails, logged once per failure, or null
 * once the board is there. The error's test id carries the refusal's code, so a browser test can
 * tell picks-hidden from a membership refusal or a server failure.
 */
export function useLeaderboardFallback(
  query: Pick<UseQueryResult, 'data' | 'error' | 'isError' | 'isLoading'>,
  { action, contestId }: { action: string; contestId: string },
): ReactElement | null {
  const { error, isError } = query;
  useEffect(() => {
    if (isError) {
      getLogger().child({ feature: 'contest-leaderboard' }).warn(
        { action, data: { contestId }, err: error },
        'Contest leaderboard failed to load',
      );
    }
  }, [action, contestId, error, isError]);

  if (query.isLoading) {
    return <LoadingState body="Loading contest leaderboard..." />;
  }
  if (isError || query.data === undefined) {
    return (
      <ErrorState
        body={extractErrorMessage(error, {
          codeMessages: LEADERBOARD_ERROR_MESSAGES,
          fallback: 'Try refreshing, or return to the contest board.',
        })}
        testId={error instanceof ApiError && error.code ? `contest-leaderboard-error-${error.code}` : 'contest-leaderboard-error'}
        title="We couldn't load this leaderboard."
      />
    );
  }
  return null;
}
