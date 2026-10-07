import { useQuery } from '@tanstack/react-query';
import { getEvent } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

export type ContestEventSchedule = {
  startDate: string;
  endDate: string | null;
};

/**
 * When a contest runs: its sport event's scheduled start and end (#221).
 *
 * The contest's own `startsAt`/`endsAt` are lifecycle stamps, set when the event actually goes
 * live and when the contest settles, so they are empty for the whole time a member is deciding
 * whether to enter. The event's start is also the entry cutoff (#430, #431). Contests on the same
 * event share one cached read.
 */
export function useContestEventSchedule(sportEventId: string | null | undefined) {
  const eventId = sportEventId ?? '';
  return useQuery({
    queryKey: QueryKeys.sportEvents.detail(eventId),
    queryFn: async (): Promise<ContestEventSchedule> => {
      const response = await getEvent({ path: { eventId } });
      if (!response.data?.event) {
        throwApiError(response.error, 'Sport event response is missing data.');
      }
      return {
        startDate: response.data.event.startDate,
        endDate: response.data.event.endDate,
      };
    },
    enabled: eventId !== '',
    retry: false,
    staleTime: 5 * 60_000,
  });
}
