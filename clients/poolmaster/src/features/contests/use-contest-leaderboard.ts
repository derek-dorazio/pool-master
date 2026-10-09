import { useQuery } from '@tanstack/react-query';
import type { ContestStatus } from '@poolmaster/shared/domain';
import { getGolfContestLeaderboard, type ContestLeaderboardResponse } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { CONTEST_POLL_INTERVAL_MS, shouldPollContestEntries } from './contest-status';

/**
 * A contest's leaderboard (#112), polled on the contest board's cadence while the contest is
 * live, so standings move without a reload and stop at settlement.
 */
export function useContestLeaderboardQuery(
  contestId: string,
  status: ContestStatus | null | undefined,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: QueryKeys.contests.leaderboard(contestId),
    queryFn: async (): Promise<ContestLeaderboardResponse> => {
      const response = await getGolfContestLeaderboard({ path: { contestId } });

      if (!response.data) {
        throwApiError(response.error, 'Contest leaderboard response is missing data.');
      }

      return response.data;
    },
    enabled: Boolean(contestId) && (options.enabled ?? true),
    retry: false,
    refetchInterval: shouldPollContestEntries(status) ? CONTEST_POLL_INTERVAL_MS : false,
  });
}
