import { useQuery } from '@tanstack/react-query';
import { listLeagues, type LeagueSummaryDto } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import { throwApiError } from '@/lib/errors';


export function useLeaguesQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: QueryKeys.leagues.list,
    queryFn: async (): Promise<LeagueSummaryDto[]> => {
      const response = await listLeagues();
      if (!response.data) {
        throwApiError(response.error, 'League list response is missing data.');
      }
      return response.data.leagues;
    },
    enabled,
    retry: false,
  });
}
