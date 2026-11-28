import { useQueries } from '@tanstack/react-query';
import { listSportLeaguesUsed, type SportLeaguesUsedResponse } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

type SportLeaguesUsedResult = { data?: SportLeaguesUsedResponse };

/** Module-level, so the map stays the same object until a year's answer changes. */
function byChampionshipYear(results: SportLeaguesUsedResult[]): ReadonlyMap<number, SportLeaguesUsedResponse> {
  return new Map(results.flatMap((result) => (
    result.data ? [[result.data.championshipYear, result.data] as const] : []
  )));
}

/**
 * One championship year's sports leagues used, and which of the `offered` sports leagues the API
 * says a new contest that year would put over the plan's cap, as a query: for a caller that needs
 * its loading and error.
 */
export function sportLeaguesUsedQuery(leagueId: string | undefined, championshipYear: number, offered: readonly string[]) {
  return {
    queryKey: QueryKeys.plans.sportLeaguesUsed(leagueId, championshipYear, offered),
    queryFn: async () => {
      const response = await listSportLeaguesUsed({ path: { id: leagueId ?? '' }, query: { championshipYear, sportLeagueIds: [...offered] } });
      if (!response.data) {
        throwApiError(response.error, 'Sports leagues used response is missing data.');
      }
      return response.data;
    },
    enabled: Boolean(leagueId),
    retry: false,
  };
}

/** A championship year and the sports leagues a page offers contests in that year. */
export interface YearOfferings {
  championshipYear: number;
  sportLeagueIds: readonly string[];
}

/**
 * Each offered championship year's answer (#947, #2021), by year: the sports leagues the league's
 * contests already use, and which offered ones are over the plan's cap. A year still loading is
 * missing from the map. Read only while `enabled`, which is when the plan has that cap.
 */
export function useSportLeaguesUsed(
  leagueId: string | undefined,
  offerings: readonly YearOfferings[],
  enabled: boolean,
): ReadonlyMap<number, SportLeaguesUsedResponse> {
  return useQueries({
    // Without the cap there is nothing to count, so no year is asked about.
    queries: (enabled ? offerings : []).map((year) => sportLeaguesUsedQuery(leagueId, year.championshipYear, year.sportLeagueIds)),
    combine: byChampionshipYear,
  });
}
