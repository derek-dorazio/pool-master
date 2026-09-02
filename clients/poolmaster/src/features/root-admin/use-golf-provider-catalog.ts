import { useQuery } from '@tanstack/react-query';
import {
  adminListProviderCatalogEvents,
  adminListProviders,
} from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminListProviderCatalogEventsResponses } from '@/lib/api';
import { resolveGolfProviderId } from './golf-admin-utils';

export type GolfProviderCatalogEvent =
  AdminListProviderCatalogEventsResponses[200]['events'][number];

/**
 * plans/124 §4.4 — one place that resolves "the" golf provider and browses its
 * live event catalog. Shared by the tournament-creation "Browse provider events"
 * mode and the Tournament Home score-source link picker so they can't drift.
 *
 * The provider is resolved client-side from the provider-health list (first
 * provider whose sportsCovered includes GOLF) because this slice's dependency
 * set ships no dedicated "provider for this sport" endpoint — see the Beads
 * close note for that recorded deviation from plan §3.4.
 */
export function useGolfProviderCatalog(params: {
  enabled: boolean;
  from?: string;
  search: string;
  sportLeagueId?: string;
  to?: string;
}) {
  const providersQuery = useQuery({
    enabled: params.enabled,
    queryKey: QueryKeys.rootAdmin.providers,
    queryFn: async () => {
      const response = await adminListProviders();
      if (!response.data?.items) {
        throw response.error ?? new Error('Provider list response is missing data.');
      }
      return response.data.items;
    },
    retry: false,
  });

  const providerId = resolveGolfProviderId(providersQuery.data);
  const trimmedSearch = params.search.trim();

  const catalogQuery = useQuery({
    enabled: params.enabled && providerId !== null,
    queryKey: QueryKeys.rootAdmin.providerCatalogEvents(
      providerId,
      'GOLF',
      trimmedSearch,
      `${params.from ?? ''}|${params.to ?? ''}|${params.sportLeagueId ?? ''}`,
    ),
    queryFn: async (): Promise<GolfProviderCatalogEvent[]> => {
      if (!providerId) {
        throw new Error('No golf provider is configured.');
      }
      const response = await adminListProviderCatalogEvents({
        path: { providerId },
        query: {
          sport: 'GOLF',
          ...(params.sportLeagueId ? { sportLeagueId: params.sportLeagueId } : {}),
          ...(params.from ? { from: params.from } : {}),
          ...(params.to ? { to: params.to } : {}),
          ...(trimmedSearch ? { search: trimmedSearch } : {}),
        },
      });
      if (!response.data?.events) {
        throw response.error ?? new Error('Provider catalog response is missing data.');
      }
      return response.data.events;
    },
    retry: false,
  });

  return {
    providerId,
    providersLoaded: providersQuery.isSuccess,
    providersError: providersQuery.isError,
    events: catalogQuery.data ?? [],
    isLoading: catalogQuery.isLoading,
    isError: catalogQuery.isError,
    error: catalogQuery.error,
  };
}
