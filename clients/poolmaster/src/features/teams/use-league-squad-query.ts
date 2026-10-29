import { useQuery } from '@tanstack/react-query';
import { getLeagueSquad, type SquadDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * One team in a league, with its owners (#1165). A page about one team reads this rather than
 * the whole team list. A team that is not in the league fails with `SQUAD_NOT_FOUND`.
 * Disabled until both ids are known, so a viewer with no team issues no request.
 */
export function useLeagueSquadQuery(leagueId: string, squadId: string | null) {
  return useQuery({
    queryKey: QueryKeys.leagueTeams.detail(leagueId, squadId ?? ''),
    queryFn: async (): Promise<SquadDto> => {
      const response = await getLeagueSquad({ path: { id: leagueId, squadId: squadId ?? '' } });

      if (!response.data?.squad) {
        throwApiError(response.error, 'Team response is missing data.');
      }

      return response.data.squad;
    },
    enabled: Boolean(leagueId && squadId),
    retry: false,
  });
}
