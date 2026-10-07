import { useQuery } from '@tanstack/react-query';
import { getEvent, type ContestDto, type SportEventDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

export type ContestSchedule = {
  startsAt: string;
  endsAt: string | null;
};

/**
 * When a contest runs (#221): its own `startsAt`/`endsAt` once set, else its sport event's
 * scheduled start and end.
 *
 * The contest's own times are lifecycle stamps: `startsAt` is written when the event goes live,
 * `endsAt` when the contest settles or a commissioner extends its deadline. Before then they are
 * empty, which is the whole time a member is deciding whether to enter, so the event's schedule
 * fills in. The event's start is also the entry cutoff (#430, #431). The event is cached whole
 * under its shared key; contests on the same event share one read.
 */
export function useContestSchedule(
  contest: Pick<ContestDto, 'sportEventId' | 'startsAt' | 'endsAt'> | undefined,
): ContestSchedule | null {
  const eventId = contest?.sportEventId ?? '';
  const eventQuery = useQuery({
    queryKey: QueryKeys.sportEvents.detail(eventId),
    queryFn: async (): Promise<SportEventDto> => {
      const response = await getEvent({ path: { eventId } });
      if (!response.data?.event) {
        throwApiError(response.error, 'Sport event response is missing data.');
      }
      return response.data.event;
    },
    select: (event) => ({ startDate: event.startDate, endDate: event.endDate }),
    enabled: eventId !== '',
    retry: false,
    staleTime: 5 * 60_000,
  });

  const startsAt = contest?.startsAt ?? eventQuery.data?.startDate;
  if (!startsAt) {
    return null;
  }
  return { startsAt, endsAt: contest?.endsAt ?? eventQuery.data?.endDate ?? null };
}
