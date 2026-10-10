import { skipToken, useQuery } from '@tanstack/react-query';
import { getContestConfiguration, type ContestManagementDetailDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * A contest as Commissioner tools reads it: its status, configuration and the tiers it takes
 * from its event. Only commissioners can read it.
 */
export function useManagedContestQuery(leagueId: string | undefined, contestId: string) {
  return useQuery({
    queryKey: QueryKeys.managedContests.byLeagueAndContest(leagueId, contestId),
    queryFn: leagueId && contestId ? async (): Promise<ContestManagementDetailDto> => {
      const response = await getContestConfiguration({
        path: { id: leagueId, contestId },
      });

      if (!response.data?.contest) {
        throwApiError(response.error, 'Managed contest response is missing data.');
      }

      return response.data.contest;
    } : skipToken,
    retry: false,
  });
}
