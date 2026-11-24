import { useQuery } from '@tanstack/react-query';
import { getSportLeague, listSportLeagueOverviews } from '@/lib/api';
import type { SportLeagueDto, SportLeagueOverviewDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * Every sport league's overview row for the Sports page (#1847): health, issues, season, next
 * event and event count, grouped by sport. All of them,
 * never paged.
 */
export function useSportLeagueOverviewsQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.overviews,
    queryFn: async (): Promise<SportLeagueOverviewDto[]> => {
      const response = await listSportLeagueOverviews();
      if (!response.data?.sportLeagues) {
        throwApiError(response.error, 'Sport league overview response is missing data.');
      }
      return response.data.sportLeagues;
    },
    retry: false,
  });
}

/** One sport league, for its settings dialog; waits while no league is open. */
export function useSportLeagueQuery(sportLeagueId: string | null) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.sportLeague(sportLeagueId ?? ''),
    queryFn: async (): Promise<SportLeagueDto> => {
      const response = await getSportLeague({ path: { sportLeagueId: sportLeagueId ?? '' } });
      if (!response.data?.sportLeague) {
        throwApiError(response.error, 'Sport league response is missing data.');
      }
      return response.data.sportLeague;
    },
    enabled: sportLeagueId !== null,
    retry: false,
  });
}
