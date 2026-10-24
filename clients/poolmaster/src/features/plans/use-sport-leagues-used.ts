import { useQueries } from '@tanstack/react-query';
import { listSportLeaguesUsed } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

type SportLeaguesUsedResult = { data?: { seasonYear: number; sportLeagueIds: string[] } };

/** Module-level, so the map stays the same object until a year's answer changes. */
function bySeasonYear(results: SportLeaguesUsedResult[]): ReadonlyMap<number, readonly string[]> {
  return new Map(results.flatMap((result) => (
    result.data ? [[result.data.seasonYear, result.data.sportLeagueIds] as const] : []
  )));
}

/**
 * The sports leagues a league's contests already use in each of `seasonYears` (#947), by year:
 * what a plan's sports-leagues-a-year cap counts. A year still loading is missing from the map.
 * Read only while `enabled`, which is when the plan has that cap.
 */
export function useSportLeaguesUsed(
  leagueId: string | undefined,
  seasonYears: readonly number[],
  enabled: boolean,
): ReadonlyMap<number, readonly string[]> {
  return useQueries({
    // Without the cap there is nothing to count, so no year is asked about.
    queries: (enabled ? seasonYears : []).map((seasonYear) => ({
      queryKey: QueryKeys.plans.sportLeaguesUsed(leagueId, seasonYear),
      queryFn: async () => {
        const response = await listSportLeaguesUsed({ path: { id: leagueId ?? '' }, query: { seasonYear } });
        if (!response.data) {
          throwApiError(response.error, 'Sports leagues used response is missing data.');
        }
        return response.data;
      },
      enabled: Boolean(leagueId),
      retry: false,
    })),
    combine: bySeasonYear,
  });
}
