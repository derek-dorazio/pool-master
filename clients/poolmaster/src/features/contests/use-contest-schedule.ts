import { useQueries, useQuery } from '@tanstack/react-query';
import { getEvent, type ContestDto, type SportEventDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

export type ContestSchedule = {
  startsAt: string;
  endsAt: string | null;
};

type ScheduledContest = Pick<ContestDto, 'sportEventId' | 'startsAt' | 'endsAt'>;

/**
 * One sport event, read through the event's shared key: the event is cached whole, and every
 * contest on the same event shares one read.
 */
export function sportEventQueryOptions(eventId: string) {
  return {
    queryKey: QueryKeys.sportEvents.detail(eventId),
    queryFn: async (): Promise<SportEventDto> => {
      const response = await getEvent({ path: { eventId } });
      if (!response.data?.event) {
        throwApiError(response.error, 'Sport event response is missing data.');
      }
      return response.data.event;
    },
    enabled: eventId !== '',
    retry: false,
    staleTime: 5 * 60_000,
  };
}

/** The sport event's schedule, from the event's shared read. */
function sportEventScheduleQuery(eventId: string) {
  return {
    ...sportEventQueryOptions(eventId),
    select: (event: SportEventDto) => ({ startDate: event.startDate, endDate: event.endDate }),
  };
}

function resolveSchedule(
  contest: ScheduledContest | undefined,
  event: { startDate: string; endDate?: string | null } | undefined,
): ContestSchedule | null {
  const startsAt = contest?.startsAt ?? event?.startDate;
  if (!startsAt) {
    return null;
  }
  return { startsAt, endsAt: contest?.endsAt ?? event?.endDate ?? null };
}

/**
 * When a contest runs (#221): its own `startsAt`/`endsAt` once set, else its sport event's
 * scheduled start and end.
 *
 * The contest's own times are lifecycle stamps: `startsAt` is written when the event goes live,
 * `endsAt` when the contest settles. Before then they are
 * empty, which is the whole time a member is deciding whether to enter, so the event's schedule
 * fills in. The event's start is also the entry cutoff (#430, #431).
 */
export function useContestSchedule(contest: ScheduledContest | undefined): ContestSchedule | null {
  const eventQuery = useQuery(sportEventScheduleQuery(contest?.sportEventId ?? ''));
  return resolveSchedule(contest, eventQuery.data);
}

/** `useContestSchedule` for a list of contests, in the same order. */
export function useContestSchedules(contests: readonly ScheduledContest[]): Array<ContestSchedule | null> {
  return useQueries({
    queries: contests.map((contest) => sportEventScheduleQuery(contest.sportEventId ?? '')),
    combine: (results) => results.map((result, index) => resolveSchedule(contests[index], result.data)),
  });
}
