import { useQuery } from '@tanstack/react-query';
import { refetchFailed } from '@/features/shared/ui';
import type { SportEventDto } from '@/lib/api';
import { squaresGameChoices, teamNamesById } from './squares-board';
import { sportLeagueQueryOptions } from './use-bracket-round-label';
import { eventFieldQueryOptions, eventGamesQueryOptions } from './use-event-games';

/**
 * The games a squares contest can be played on, for the chosen event (#711): its games still to
 * kick off, the final first, with the field's team names. Games before the sport league's first
 * squares round are left out (#787: a Champions League two-legged tie). Reads nothing until an
 * event is chosen.
 */
export function useSquaresGameChoices(event: SportEventDto | null, now: Date) {
  const eventId = event?.id ?? '';
  const gamesQuery = useQuery(eventGamesQueryOptions(eventId));
  const fieldQuery = useQuery({ ...eventFieldQueryOptions(eventId), select: teamNamesById });
  const sportLeagueQuery = useQuery(sportLeagueQueryOptions(event?.sportLeagueId ?? ''));
  return {
    games: squaresGameChoices(gamesQuery.data ?? [], now, sportLeagueQuery.data?.squaresFromRound ?? null),
    namesById: fieldQuery.data ?? new Map<string, string>(),
    isLoading: gamesQuery.isLoading || fieldQuery.isLoading || sportLeagueQuery.isLoading,
    isError: gamesQuery.isError || fieldQuery.isError || sportLeagueQuery.isError,
    /** Reads again whichever of the three failed. */
    retry: refetchFailed(gamesQuery, fieldQuery, sportLeagueQuery),
  };
}
