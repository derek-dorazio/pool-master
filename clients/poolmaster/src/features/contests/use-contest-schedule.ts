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

/**
 * When a contest runs (#221): its own `startsAt`/`endsAt` once set, else its first event's
 * scheduled start and its last event's scheduled end (#713), both carried on the contest, so the
 * schedule reads no event (#1198).
 *
 * The contest's own times are lifecycle stamps: `startsAt` is written when the event goes live,
 * `endsAt` when the contest settles. Before then they are
 * empty, which is the whole time a member is deciding whether to enter, so the event's schedule
 * fills in. The first event's start is also the entry cutoff (#430, #431).
 */
export function contestSchedule(contest: ScheduledContest | undefined): ContestSchedule | null {
  if (!contest) {
    return null;
  }
  const startsAt = contest.startsAt ?? firstContestEvent(contest)?.startDate;
  if (!startsAt) {
    return null;
  }
  return { startsAt, endsAt: contest.endsAt ?? lastContestEvent(contest)?.endDate ?? null };
}

/**
 * When a listed contest starts: its own `startsAt` once set, else its first event's start, which
 * the contest list carries (#577), so a list never reads its events one by one.
 */
export function listedContestStartsAt(contest: Pick<ContestDto, 'startsAt' | 'sportEvents'>): string | null {
  return contest.startsAt ?? firstContestEvent(contest)?.startDate ?? null;
}
