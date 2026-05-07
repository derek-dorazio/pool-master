import { useQuery } from '@tanstack/react-query';
import { listLeagues, type ListLeaguesResponses } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';

type LeagueSummary = ListLeaguesResponses[200]['leagues'][number];

export function useLeaguesQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: QueryKeys.leagues.list,
    queryFn: async (): Promise<LeagueSummary[]> => {
      const response = await listLeagues();
      if (!response.data) {
        throw response.error ?? new Error('League list response is missing data.');
      }
      return response.data.leagues;
    },
    enabled,
    retry: false,
  });
}
