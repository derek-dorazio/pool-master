import { useQuery } from '@tanstack/react-query';
import {
  getEventOverview,
  listEventContests,
  type SportEventContestDto,
  type SportEventOverviewDto,
} from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** The Event page's header and sync rows (#1890): its syncs, health, issues, release and tier order. */
export function useSportEventOverviewQuery(eventId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.eventOverview(eventId),
    queryFn: async (): Promise<SportEventOverviewDto> => {
      const response = await getEventOverview({ path: { eventId } });
      if (!response.data?.overview) throwApiError(response.error, 'Event overview response is missing data.');
      return response.data.overview;
    },
    retry: false,
  });
}

/** The Event page's Contests grid (#1890): every customer contest on the event, across leagues. */
export function useSportEventContestsQuery(eventId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.eventContests(eventId),
    queryFn: async (): Promise<SportEventContestDto[]> => {
      const response = await listEventContests({ path: { eventId } });
      if (!response.data?.contests) throwApiError(response.error, 'Event contests response is missing data.');
      return response.data.contests;
    },
    retry: false,
  });
}
