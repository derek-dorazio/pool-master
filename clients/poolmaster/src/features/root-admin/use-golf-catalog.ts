import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listParticipants, listSeasons, listSportLeagues, listSports } from '@/lib/api';
import type { ParticipantDto, SeasonDto, SportLeagueDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * #236 — the golf screens' reads of the shared sport catalog, in one place. The golf
 * admin list operations these replace answered "every golf tour" and "every golf season"
 * in one call; the shared operations are scoped (sport leagues by sport, seasons by
 * sport league), so the all-seasons read lists the golf sport leagues and then each
 * one's seasons, and golfers are the participants of the golf sport.
 */

async function fetchGolfSportLeagues(): Promise<SportLeagueDto[]> {
  const response = await listSportLeagues({ query: { sport: 'GOLF' } });
  if (!response.data?.sportLeagues) {
    throwApiError(response.error, 'Golf tour list response is missing data.');
  }
  return response.data.sportLeagues;
}

async function fetchSeasons(sportLeagueId: string): Promise<SeasonDto[]> {
  const response = await listSeasons({ path: { sportLeagueId } });
  if (!response.data?.seasons) {
    throwApiError(response.error, 'Golf season list response is missing data.');
  }
  return response.data.seasons;
}

export function useGolfSportLeaguesQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.golf.tours,
    queryFn: fetchGolfSportLeagues,
    retry: false,
  });
}

/**
 * Seasons of one golf sport league, or of every golf sport league when none is given.
 * Active and inactive seasons both come back; a caller that wants only active ones
 * filters, so the two views share one cache entry.
 */
export function useGolfSeasonsQuery(sportLeagueId?: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.golf.seasons(sportLeagueId),
    queryFn: async (): Promise<SeasonDto[]> => {
      if (sportLeagueId) {
        return fetchSeasons(sportLeagueId);
      }
      const sportLeagues = await fetchGolfSportLeagues();
      const perLeague = await Promise.all(sportLeagues.map((sportLeague) => fetchSeasons(sportLeague.id)));
      return perLeague.flat();
    },
    retry: false,
  });
}

const golfSportQueryOptions = {
  queryKey: QueryKeys.rootAdmin.golf.sport,
  queryFn: async () => {
    const response = await listSports();
    if (!response.data?.sports) {
      throwApiError(response.error, 'Sport list response is missing data.');
    }
    const golf = response.data.sports.find((sport) => sport.name === 'GOLF');
    if (!golf) {
      throw new Error('The golf sport is not set up.');
    }
    return golf;
  },
  // The sport row does not change while the app runs.
  staleTime: Infinity,
  retry: false,
};

/**
 * Golfers: the golf sport's participants, filtered by status and a name search. The
 * sport's id comes through the query cache, so it is fetched once. The golf player
 * list this replaces defaulted to ACTIVE; `listParticipants` has no default, so
 * callers say which status they want.
 */
export function useGolfPlayersQuery(params: {
  queryKey: readonly unknown[];
  status?: ParticipantDto['status'];
  q?: string;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: params.queryKey,
    queryFn: async (): Promise<ParticipantDto[]> => {
      const golf = await queryClient.fetchQuery(golfSportQueryOptions);
      const response = await listParticipants({
        query: {
          sportId: golf.id,
          ...(params.status ? { status: params.status } : {}),
          ...(params.q ? { q: params.q } : {}),
        },
      });
      if (!response.data?.participants) {
        throwApiError(response.error, 'Golf player list response is missing data.');
      }
      return response.data.participants;
    },
    enabled: params.enabled ?? true,
    retry: false,
  });
}

/** The golf sport's id, for creating a golfer. */
export function useGolfSportQuery() {
  return useQuery(golfSportQueryOptions);
}
