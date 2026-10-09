import { useQuery } from '@tanstack/react-query';
import { listContests, type ContestDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** Every contest in a league. One query and one cache entry for every page. */
export function useLeagueContestsQuery(leagueId: string) {
  return useQuery({
    queryKey: QueryKeys.contests.list({ leagueId }),
    queryFn: async (): Promise<ContestDto[]> => {
      const response = await listContests({ path: { id: leagueId } });

      if (!response.data?.contests) {
        throwApiError(response.error, 'Contest list response is missing data.');
      }

      return response.data.contests;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });
}
