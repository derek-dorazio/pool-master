import { useQuery } from '@tanstack/react-query';
import { getEventBracket, listEventParticipants, type SportEventDto, type SportEventMatchDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { squaresGameChoices, teamNamesById } from './squares-board';
import { sportLeagueQueryOptions } from './use-bracket-round-label';

/**
 * The games a squares contest can be played on, for the chosen event (#711): its games still to
 * kick off, the final first, with the field's team names. Games before the sport league's first
 * squares round are left out (#787: a Champions League two-legged tie). Reads nothing until an
 * event is chosen.
 */
export function useSquaresGameChoices(event: SportEventDto | null, now: Date) {
  const eventId = event?.id ?? '';
  const gamesQuery = useQuery({
    queryKey: QueryKeys.sportEvents.games(eventId),
    queryFn: async (): Promise<SportEventMatchDto[]> => {
      const response = await getEventBracket({ path: { eventId } });
      if (!response.data?.matches) {
        throwApiError(response.error, 'Event games response is missing data.');
      }
      return response.data.matches;
    },
    enabled: eventId !== '',
    retry: false,
  });
  const fieldQuery = useQuery({
    queryKey: QueryKeys.sportEvents.field(eventId),
    queryFn: async () => {
      const response = await listEventParticipants({ path: { eventId } });
      if (!response.data?.participants) {
        throwApiError(response.error, 'Event field response is missing data.');
      }
      return teamNamesById(response.data.participants);
    },
    enabled: eventId !== '',
    retry: false,
  });
  const sportLeagueQuery = useQuery(sportLeagueQueryOptions(event?.sportLeagueId ?? ''));
  return {
    games: squaresGameChoices(gamesQuery.data ?? [], now, sportLeagueQuery.data?.squaresFromRound ?? null),
    namesById: fieldQuery.data ?? new Map<string, string>(),
    isLoading: gamesQuery.isLoading || fieldQuery.isLoading || sportLeagueQuery.isLoading,
    isError: gamesQuery.isError || fieldQuery.isError || sportLeagueQuery.isError,
  };
}
