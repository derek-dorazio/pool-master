import { useQuery } from '@tanstack/react-query';
import { getEvent, type ContestDto, type SportEventDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { firstContestEvent, lastContestEvent } from './contest-events';

export type ContestSchedule = {
  startsAt: string;
  endsAt: string | null;
};

type ScheduledContest = Pick<ContestDto, 'sportEvents' | 'startsAt' | 'endsAt'>;

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

/** The sport event's scheduled end, from the event's shared read. */
function sportEventEndQuery(eventId: string) {
  return {
    ...sportEventQueryOptions(eventId),
    select: (event: SportEventDto) => event.endDate ?? null,
  };
}

function resolveSchedule(
  contest: ScheduledContest | undefined,
  lastEventEndsAt: string | null | undefined,
): ContestSchedule | null {
  const startsAt = contest?.startsAt ?? (contest ? firstContestEvent(contest)?.startDate : undefined);
  if (!startsAt) {
    return null;
  }
  return { startsAt, endsAt: contest?.endsAt ?? lastEventEndsAt ?? null };
}

/**
 * When a contest runs (#221): its own `startsAt`/`endsAt` once set, else its first event's
 * scheduled start and its last event's scheduled end (#713).
 *
 * The contest's own times are lifecycle stamps: `startsAt` is written when the event goes live,
 * `endsAt` when the contest settles. Before then they are
 * empty, which is the whole time a member is deciding whether to enter, so the event's schedule
 * fills in. The first event's start is also the entry cutoff (#430, #431).
 */
export function useContestSchedule(contest: ScheduledContest | undefined): ContestSchedule | null {
  const lastEventId = contest ? lastContestEvent(contest)?.sportEventId : undefined;
  const lastEventEndQuery = useQuery(sportEventEndQuery(lastEventId ?? ''));
  return resolveSchedule(contest, lastEventEndQuery.data);
}

/**
 * When a listed contest starts: its own `startsAt` once set, else its first event's start, which
 * the contest list carries (#577), so a list never reads its events one by one.
 */
export function listedContestStartsAt(contest: Pick<ContestDto, 'startsAt' | 'sportEvents'>): string | null {
  return contest.startsAt ?? firstContestEvent(contest)?.startDate ?? null;
}
