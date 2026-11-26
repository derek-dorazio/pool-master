import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { roundLabels } from '@poolmaster/shared/display-strings';
import type { RoundName } from '@poolmaster/shared/domain';
import { getSportLeague, listEventRounds, type SportEventRoundDto, type SportLeagueDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** A sport league's shared read; an empty `sportLeagueId` reads nothing. */
export function sportLeagueQueryOptions(sportLeagueId: string) {
  return {
    queryKey: QueryKeys.sportLeagues.detail(sportLeagueId),
    queryFn: async (): Promise<SportLeagueDto> => {
      const response = await getSportLeague({ path: { sportLeagueId } });
      if (!response.data?.sportLeague) {
        throwApiError(response.error, 'Sport league response is missing data.');
      }
      return response.data.sportLeague;
    },
    enabled: sportLeagueId !== '',
    retry: false,
    // A league's reference data changes only when an admin edits it.
    staleTime: 5 * 60_000,
  };
}

/**
 * An event's rounds, each with the slot it is played in (#2006). One read under the event's key,
 * so the admin screens and the contest screens share it. An empty `eventId` reads nothing.
 */
export function sportEventRoundsQueryOptions(eventId: string) {
  return {
    queryKey: QueryKeys.rootAdmin.manageSport.rounds(eventId),
    queryFn: async (): Promise<SportEventRoundDto[]> => {
      const response = await listEventRounds({ path: { eventId } });
      if (!response.data?.rounds) {
        throwApiError(response.error, 'Event rounds response is missing data.');
      }
      return response.data.rounds;
    },
    enabled: eventId !== '',
    retry: false,
  };
}

/**
 * What an event's rounds are called (#2006): each by the slot it is played in ("Sweet 16", "Super
 * Bowl", "Week 14"), and rounds that share a slot (a golf tournament's) by number, with whether
 * they are still loading. A screen waits while they load, so a round never shows as "Round N"
 * first (#2198, #2200). An empty `eventId` reads nothing and is not loading; a failed read is not
 * loading either, and its rounds read "Round N".
 */
export function useEventRoundNames(eventId: string): { nameOfRound: RoundName; isLoading: boolean } {
  const roundsQuery = useQuery(sportEventRoundsQueryOptions(eventId));
  const nameOfRound = useMemo(() => roundLabels(roundsQuery.data ?? []), [roundsQuery.data]);
  return { nameOfRound, isLoading: roundsQuery.isLoading };
}
