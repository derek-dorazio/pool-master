import { useQuery } from '@tanstack/react-query';
import { getChampionship, type ChampionshipDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** One year of the league championship (#863): standings, medal tiles and progress. */
export function useChampionshipQuery(leagueId: string, year: number) {
  return useQuery({
    queryKey: QueryKeys.championship.byYear(leagueId, year),
    queryFn: async (): Promise<ChampionshipDto> => {
      const response = await getChampionship({ path: { id: leagueId, year } });

      if (!response.data?.championship) {
        throwApiError(response.error, 'Championship response is missing data.');
      }

      return response.data.championship;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });
}
