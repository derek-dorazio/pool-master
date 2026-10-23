import { useQuery } from '@tanstack/react-query';
import { getCupSquadPoints, listCups, type CupDto, type CupSquadPointsDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** A league's sports league cups of one season, each with its standings and contests (#841). */
export function useSeasonCupsQuery(leagueId: string, seasonYear: number) {
  return useQuery({
    queryKey: QueryKeys.cups.bySeason(leagueId, seasonYear),
    queryFn: async (): Promise<CupDto[]> => {
      const response = await listCups({ path: { id: leagueId }, query: { seasonYear } });

      if (!response.data?.cups) {
        throwApiError(response.error, 'Cup list response is missing data.');
      }

      return response.data.cups;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });
}

/** One squad's points in a cup, counted contest by counted contest. */
export function useCupSquadPointsQuery(leagueId: string, cupId: string, squadId: string) {
  return useQuery({
    queryKey: QueryKeys.cups.squadPoints(leagueId, cupId, squadId),
    queryFn: async (): Promise<CupSquadPointsDto> => {
      const response = await getCupSquadPoints({ path: { id: leagueId, cupId, squadId } });

      if (!response.data?.squadPoints) {
        throwApiError(response.error, 'Cup squad points response is missing data.');
      }

      return response.data.squadPoints;
    },
    enabled: Boolean(leagueId && cupId && squadId),
    retry: false,
  });
}
