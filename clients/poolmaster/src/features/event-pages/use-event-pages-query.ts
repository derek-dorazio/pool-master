import { useQuery } from '@tanstack/react-query';
import type { Sport } from '@poolmaster/shared/domain';
import { getEventPage, listEventPages, type EventPageDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** One event page by its address (#1007), public: active or retired, with its offers' editions. */
export function useEventPageQuery(sport: Sport | null, pageSlug: string | undefined) {
  return useQuery({
    queryKey: QueryKeys.eventPages.detail(sport ?? '', pageSlug ?? ''),
    queryFn: async (): Promise<EventPageDto> => {
      const response = await getEventPage({ path: { sport: sport as Sport, pageSlug: pageSlug ?? '' } });
      if (!response.data?.eventPage) {
        throwApiError(response.error, 'Event page response is missing data.');
      }
      return response.data.eventPage;
    },
    enabled: sport !== null && pageSlug !== undefined,
    retry: false,
  });
}

/** The active event pages, of one sport or every sport: the Coming up rows. */
export function useEventPagesQuery(sport?: Sport) {
  return useQuery({
    queryKey: QueryKeys.eventPages.list(sport ?? null),
    queryFn: async (): Promise<EventPageDto[]> => {
      const response = await listEventPages({ query: sport ? { sport } : {} });
      if (!response.data?.eventPages) {
        throwApiError(response.error, 'Event page list response is missing data.');
      }
      return response.data.eventPages;
    },
    retry: false,
  });
}
