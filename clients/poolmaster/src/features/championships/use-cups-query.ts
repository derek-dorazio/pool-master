import { useQuery } from '@tanstack/react-query';
import { getCupProjection, getCupSquadPoints, listCups, type CupDto, type CupProjectionDto, type CupSquadPointsDto } from '@/lib/api';
import { CONTEST_POLL_INTERVAL_MS } from '@/features/contests/contest-status';
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

/**
 * An open cup's standings if its live contests ended now: read only while one is live, and
 * refreshed as often as a live leaderboard until a read fails.
 */
export function useCupProjectionQuery(leagueId: string, cupId: string, isLive: boolean) {
  return useQuery({
    queryKey: QueryKeys.cups.projection(leagueId, cupId),
    queryFn: async (): Promise<CupProjectionDto> => {
      const response = await getCupProjection({ path: { id: leagueId, cupId } });

      if (!response.data?.projection) {
        throwApiError(response.error, 'Cup projection response is missing data.');
      }

      return response.data.projection;
    },
    enabled: Boolean(leagueId && cupId) && isLive,
    // A projection that failed stays failed until the page is opened again, rather than asking every 30s.
    refetchInterval: (query) => (isLive && query.state.status !== 'error' ? CONTEST_POLL_INTERVAL_MS : false),
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
