import { useQuery } from '@tanstack/react-query';
import { refetchFailed } from '@/features/shared/ui';
import { listEventSquaresGames, type SportEventDto, type SquaresGameChoicesResponse } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { teamNamesById } from './squares-board';
import { eventFieldQueryOptions } from './use-event-games';

/** The Games of one event a squares contest can be played on, as the API decides them (#2050). */
function squaresGamesQueryOptions(eventId: string) {
  return {
    queryKey: QueryKeys.sportEvents.squaresGames(eventId),
    queryFn: async (): Promise<SquaresGameChoicesResponse> => {
      const response = await listEventSquaresGames({ path: { eventId } });
      if (!response.data) {
        throwApiError(response.error, 'Squares game choices response is missing data.');
      }
      return response.data;
    },
    enabled: eventId !== '',
    retry: false,
  };
}

/**
 * The Games a squares contest can be played on, for the chosen event (#711, #2050): the API's
 * choices and its default, with the field's team names. Reads nothing until an event is chosen.
 */
export function useSquaresGameChoices(event: SportEventDto | null) {
  const eventId = event?.id ?? '';
  const choicesQuery = useQuery(squaresGamesQueryOptions(eventId));
  const fieldQuery = useQuery({ ...eventFieldQueryOptions(eventId), select: teamNamesById });
  return {
    games: choicesQuery.data?.games ?? [],
    defaultGameId: choicesQuery.data?.defaultSportEventRoundMatchGameId ?? null,
    namesById: fieldQuery.data ?? new Map<string, string>(),
    isLoading: choicesQuery.isLoading || fieldQuery.isLoading,
    isError: choicesQuery.isError || fieldQuery.isError,
    /** Reads again whichever of the two failed. */
    retry: refetchFailed(choicesQuery, fieldQuery),
  };
}
