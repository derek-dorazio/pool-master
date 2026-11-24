import { useQuery } from '@tanstack/react-query';
import { listSportLeagueSeasons, type SportLeagueSeasonDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * A sport league's Seasons (#2003), latest first, each labelled by its name: what every Season
 * picker offers, the Structure tab lists and an event's edition is named by. An empty
 * `sportLeagueId` reads nothing. Seasons are added by migration, so the read stays fresh a while.
 */
export function sportLeagueSeasonsQueryOptions(sportLeagueId: string) {
  return {
    queryKey: QueryKeys.sportLeagues.seasons(sportLeagueId),
    queryFn: async (): Promise<SportLeagueSeasonDto[]> => {
      const response = await listSportLeagueSeasons({ path: { sportLeagueId } });
      if (!response.data?.seasons) {
        throwApiError(response.error, 'Sport league Seasons response is missing data.');
      }
      return response.data.seasons;
    },
    enabled: sportLeagueId !== '',
    retry: false,
    staleTime: 5 * 60_000,
  };
}

export function useSportLeagueSeasonsQuery(sportLeagueId: string) {
  return useQuery(sportLeagueSeasonsQueryOptions(sportLeagueId));
}

/**
 * The Season a picker opens on: the one chosen, else the league's current Season, which the API
 * names. Null only for a league no migration has given a Season.
 */
export function seasonIdOrCurrent(
  chosen: string | null,
  sportLeague: { currentSeasonId: string | null } | undefined,
): string | null {
  return chosen ?? sportLeague?.currentSeasonId ?? null;
}
