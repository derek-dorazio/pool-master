import { isApiErrorCode } from '@poolmaster/shared/dto';
import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, type ReactElement } from 'react';
import { ErrorState, LoadingState } from '@/features/shared/ui';
import { ApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { LEADERBOARD_ERROR_MESSAGES } from './contest-leaderboard';

/**
 * What a board shows while its read loads or after it fails, logged once per failure, or null
 * once the board is there. The error's test id carries the refusal's code, so a browser test can
 * tell picks-hidden from a membership refusal or a server failure.
 */
export function useLeaderboardFallback(
  query: Pick<UseQueryResult, 'data' | 'error' | 'isError' | 'isLoading' | 'refetch'>,
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
    // A refusal (picks hidden, not a member) will not change on a second read, so it offers no Retry.
    const refusal = error instanceof ApiError && error.code !== undefined && isApiErrorCode(error.code)
      ? LEADERBOARD_ERROR_MESSAGES[error.code]
      : undefined;
    return (
      <ErrorState
        body={refusal}
        onRetry={refusal ? null : () => void query.refetch()}
        testId={error instanceof ApiError && error.code ? `contest-leaderboard-error-${error.code}` : 'contest-leaderboard-error'}
        title="We couldn't load this leaderboard."
      />
    );
  }
  return null;
}
