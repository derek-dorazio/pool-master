import { useQuery } from '@tanstack/react-query';
import { listLeagueSquads, type SquadDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** Every team in a league, with its owners. One query and one cache entry for every page. */
export function useLeagueSquadsQuery(leagueId: string) {
  return useQuery({
    queryKey: QueryKeys.leagueTeams.byLeague(leagueId),
    queryFn: async (): Promise<SquadDto[]> => {
      const response = await listLeagueSquads({ path: { id: leagueId } });

      if (!response.data?.squads) {
        throwApiError(response.error, 'Team list response is missing data.');
      }

      return response.data.squads;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });
}
