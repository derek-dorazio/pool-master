import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listEvents, listParticipants, listSportLeagues, listSports } from '@/lib/api';
import type { ParticipantDto, SportEventDto, SportLeagueDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * #236 — the golf screens' reads of the shared sport catalog, in one place: the golf
 * tours (sport leagues of the golf sport), one tour's tournaments across every event
 * year (plans/147 — the event list filtered by sport league), and golfers, the
 * participants of the golf sport.
 */

async function fetchGolfSportLeagues(): Promise<SportLeagueDto[]> {
  const response = await listSportLeagues({ query: { sport: 'GOLF' } });
  if (!response.data?.sportLeagues) {
    throwApiError(response.error, 'Golf tour list response is missing data.');
  }
  return response.data.sportLeagues;
}

export function useGolfSportLeaguesQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.golf.tours,
    queryFn: fetchGolfSportLeagues,
    retry: false,
  });
}

/** One golf tour's tournaments, every event year, earliest start first. */
export function useGolfTourTournamentsQuery(sportLeagueId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.golf.tourTournaments(sportLeagueId),
    queryFn: async (): Promise<SportEventDto[]> => {
      const response = await listEvents({ query: { sportLeagueId } });
      if (!response.data?.events) {
        throwApiError(response.error, 'Golf tournament list response is missing data.');
      }
      return response.data.events;
    },
    enabled: sportLeagueId !== '',
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
      const golf = await queryClient.query(golfSportQueryOptions);
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
