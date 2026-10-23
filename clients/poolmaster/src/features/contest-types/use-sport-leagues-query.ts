import { useQuery } from '@tanstack/react-query';
import { listSportLeagues, type SportLeagueDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * Every sport league, of every sport: how the contest types pages name the NFL or the PGA TOUR.
 * Anyone may read them, signed in or not, as the contest templates.
 */
export function useSportLeaguesQuery() {
  return useQuery({
    queryKey: QueryKeys.sportLeagues.list(),
    queryFn: async (): Promise<SportLeagueDto[]> => {
      const response = await listSportLeagues();
      if (!response.data?.sportLeagues) {
        throwApiError(response.error, 'Sport league list response is missing data.');
      }
      return response.data.sportLeagues;
    },
    retry: false,
  });
}
