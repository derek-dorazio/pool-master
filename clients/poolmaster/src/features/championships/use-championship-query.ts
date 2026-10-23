import { useQuery } from '@tanstack/react-query';
import { getChampionship, listChampionshipYears, type ChampionshipDto, type ChampionshipYearDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** The league championship's years with a counted contest, newest first (#863). */
export function useChampionshipYearsQuery(leagueId: string) {
  return useQuery({
    queryKey: QueryKeys.championship.years(leagueId),
    queryFn: async (): Promise<ChampionshipYearDto[]> => {
      const response = await listChampionshipYears({ path: { id: leagueId } });

      if (!response.data?.years) {
        throwApiError(response.error, 'Championship years response is missing data.');
      }

      return response.data.years;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });
}

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
