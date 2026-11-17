import { useQuery } from '@tanstack/react-query';
import type { ContestStatus } from '@poolmaster/shared/domain';
import { getEventBracket, type SportEventMatchDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { CONTEST_POLL_INTERVAL_MS, shouldPollContestEntries } from './contest-status';

/** One event's games (its bracket's matches), the shared read; an empty `eventId` reads nothing. */
export function eventGamesQueryOptions(eventId: string) {
  return {
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
  };
}

/**
 * The games a team-picks leaderboard describes (#1748): each team's results and next game. Read
 * only when `enabled` (a head-to-head board), and polled on the leaderboard's cadence while the
 * contest is live, so a result shows on the board and in its games together.
 */
export function useLeaderboardEventGames(eventId: string, status: ContestStatus | null | undefined, enabled: boolean) {
  return useQuery({
    ...eventGamesQueryOptions(eventId),
    enabled: enabled && eventId !== '',
    refetchInterval: shouldPollContestEntries(status) ? CONTEST_POLL_INTERVAL_MS : false,
  });
}
