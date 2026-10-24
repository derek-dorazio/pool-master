import { useQuery } from '@tanstack/react-query';
import { getLeaguePlanUsage, type LeaguePlanUsageResponse } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * What the league uses of its plan's caps now (#972): this year's sports leagues, and every
 * contest still taking entries with its entries, drafts included. Commissioners only.
 */
export function useLeaguePlanUsageQuery(leagueId: string) {
  return useQuery({
    queryKey: QueryKeys.plans.usage(leagueId),
    queryFn: async (): Promise<LeaguePlanUsageResponse> => {
      const response = await getLeaguePlanUsage({ path: { id: leagueId } });
      if (!response.data) {
        throwApiError(response.error, 'Plan usage response is missing data.');
      }
      return response.data;
    },
    retry: false,
  });
}
