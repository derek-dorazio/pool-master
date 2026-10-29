import { useQuery } from '@tanstack/react-query';
import { listContestFinishedYears, listContests, type ContestDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * A league's current contests (#1161): in setup, open and live. One query and one cache entry for
 * every page. A finished contest is on `useLeagueFinishedContestsQuery`, one year at a time.
 */
export function useLeagueContestsQuery(leagueId: string) {
  return useQuery({
    queryKey: QueryKeys.contests.list({ leagueId }),
    queryFn: async (): Promise<ContestDto[]> => {
      const response = await listContests({ path: { id: leagueId } });

      if (!response.data?.contests) {
        throwApiError(response.error, 'Contest list response is missing data.');
      }

      return response.data.contests;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });
}

/** The contests that went final in one championship year (#1161). Asks for nothing until a year is chosen. */
export function useLeagueFinishedContestsQuery(leagueId: string, year: number | null) {
  return useQuery({
    queryKey: QueryKeys.contests.finished(leagueId, year),
    queryFn: async (): Promise<ContestDto[]> => {
      if (year === null) {
        throw new Error('Finished contests asked for without a year.');
      }
      const response = await listContests({ path: { id: leagueId }, query: { finishedYear: year } });

      if (!response.data?.contests) {
        throwApiError(response.error, 'Finished contest list response is missing data.');
      }

      return response.data.contests;
    },
    enabled: Boolean(leagueId) && year !== null,
    retry: false,
  });
}

/** The championship years a league has finished contests in, newest first (#1161). */
export function useContestFinishedYearsQuery(leagueId: string) {
  return useQuery({
    queryKey: QueryKeys.contests.finishedYears(leagueId),
    queryFn: async (): Promise<number[]> => {
      const response = await listContestFinishedYears({ path: { id: leagueId } });

      if (!response.data?.years) {
        throwApiError(response.error, 'Finished contest years response is missing data.');
      }

      return response.data.years;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });
}
