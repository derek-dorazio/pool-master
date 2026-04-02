import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { clientPath, API_ROUTES } from '@poolmaster/shared/api-routes';
import type { LeagueSummaryDto, LeagueListResponse } from '@poolmaster/shared/dto';

export function useMyLeagues() {
  return useQuery({
    queryKey: ['dashboard', 'leagues'],
    queryFn: async (): Promise<LeagueSummaryDto[]> => {
      // TODO: migrate to client.GET('/api/v1/leagues/') when the OpenAPI spec
      // defines the response content type for listLeagues (currently content?: never)
      const res = await api.get<LeagueListResponse>(clientPath(API_ROUTES.leagues.list));
      return res.leagues;
    },
  });
}
