import { OFFERABLE_SPORT_EVENT_STATUSES, type Sport } from '@poolmaster/shared/domain';
import { listEvents, type SportEventDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * A sport's events that can still take a contest, soonest first: what Create contest chooses an
 * event from, and what the contest types page checks for an event to create each contest type on
 * (#803). One query per sport, shared by both.
 */
export function sportEventsQueryOptions(sport: Sport, enabled: boolean) {
  return {
    queryKey: QueryKeys.sportEvents.offerable(sport),
    queryFn: async (): Promise<SportEventDto[]> => {
      const response = await listEvents({ query: { sport, status: [...OFFERABLE_SPORT_EVENT_STATUSES] } });
      if (!response.data?.events) {
        throwApiError(response.error, 'Sport event list response is missing data.');
      }
      return [...response.data.events].sort((left, right) => Date.parse(left.startDate) - Date.parse(right.startDate));
    },
    enabled,
    retry: false,
  };
}
