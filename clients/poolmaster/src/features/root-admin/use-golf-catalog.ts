import { findSportRow, getSportDefinition, type Sport } from '@poolmaster/shared/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getParticipant, listEvents, listParticipants, listSportLeagues, listSports } from '@/lib/api';
import type { ParticipantDto, SportEventDto, SportLeagueDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * #236 — the Manage sport screens' reads of the shared sport catalog, in one place: a sport's
 * leagues (golf's tours), one sport league's events across every event year (plans/147 — the
 * event list filtered by sport league), and a sport's participants (golfers, horses). Built for
 * golf first; every sport's pages read through them since #623.
 */

export function useGolfSportLeaguesQuery(sport: Sport) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.golf.sportTours(sport),
    queryFn: async (): Promise<SportLeagueDto[]> => {
      const response = await listSportLeagues({ query: { sport } });
      if (!response.data?.sportLeagues) {
        throwApiError(response.error, 'Sport league list response is missing data.');
      }
      return response.data.sportLeagues;
    },
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
        throwApiError(response.error, 'Sport league event list response is missing data.');
      }
      return response.data.events;
    },
    enabled: sportLeagueId !== '',
    retry: false,
  });
}

function sportRowQueryOptions(sport: Sport) {
  return {
    queryKey: QueryKeys.rootAdmin.golf.sport(sport),
    queryFn: async () => {
      const response = await listSports();
      if (!response.data?.sports) {
        throwApiError(response.error, 'Sport list response is missing data.');
      }
      const row = findSportRow(response.data.sports, sport);
      if (!row) {
        throw new Error(`${getSportDefinition(sport).name} is not set up.`);
      }
      return row;
    },
    // The sport row does not change while the app runs.
    staleTime: Infinity,
    retry: false,
  };
}

/**
 * A sport's participants, filtered by status and a name search. The sport's id comes
 * through the query cache, so it is fetched once. The golf player list this replaces
 * defaulted to ACTIVE; `listParticipants` has no default, so callers say which status
 * they want.
 */
export function useGolfPlayersQuery(params: {
  sport: Sport;
  queryKey: readonly unknown[];
  status?: ParticipantDto['status'];
  q?: string;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: params.queryKey,
    queryFn: async (): Promise<ParticipantDto[]> => {
      const sportRow = await queryClient.query(sportRowQueryOptions(params.sport));
      const response = await listParticipants({
        query: {
          sportId: sportRow.id,
          ...(params.status ? { status: params.status } : {}),
          ...(params.q ? { q: params.q } : {}),
        },
      });
      if (!response.data?.participants) {
        throwApiError(response.error, 'Participant list response is missing data.');
      }
      return response.data.participants;
    },
    enabled: params.enabled ?? true,
    retry: false,
  });
}

/** A sport's row, whose id a new participant of the sport is created with. */
export function useGolfSportQuery(sport: Sport) {
  return useQuery(sportRowQueryOptions(sport));
}

/** One participant, for its page and its edit page. */
export function useGolfPlayerQuery(participantId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.golf.player(participantId),
    queryFn: async (): Promise<ParticipantDto> => {
      const response = await getParticipant({ path: { id: participantId } });
      if (!response.data?.participant) {
        throwApiError(response.error, 'Participant response is missing data.');
      }
      return response.data.participant;
    },
    enabled: participantId !== '',
    retry: false,
  });
}
