import { skipToken, useQuery } from '@tanstack/react-query';
import { getContestExpansion, type ContestExpansionResponse } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** A contest's entry cap and the expansions it can take (#987). Commissioners and root admins only. */
export function useContestExpansionQuery(leagueId: string | undefined, contestId: string) {
  return useQuery({
    queryKey: QueryKeys.contestExpansions.detail(leagueId, contestId),
    queryFn: leagueId && contestId ? async (): Promise<ContestExpansionResponse> => {
      const response = await getContestExpansion({ path: { id: leagueId, contestId } });
      if (!response.data) {
        throwApiError(response.error, 'Contest expansion response is missing data.');
      }
      return response.data;
    } : skipToken,
    retry: false,
  });
}
