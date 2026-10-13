import type { Sport } from '@poolmaster/shared/domain';
import { useQuery } from '@tanstack/react-query';
import { listProviderCatalogEvents, listProviders } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import type { ProviderEventDto } from '@/lib/api';
import { resolveSportProviderId } from './sport-admin-utils';
import { throwApiError } from '@/lib/errors';

export type ProviderCatalogEvent = ProviderEventDto;

/**
 * A sport's provider id, resolved from the provider list (the first provider covering the
 * sport); null when none does, as for horse racing today. Shared by the catalog browse below
 * and the sport league year import (#385).
 */
export function useSportProviderId(enabled: boolean, sport: Sport) {
  const providersQuery = useQuery({
    enabled,
    queryKey: QueryKeys.rootAdmin.providers,
    queryFn: async () => {
      const response = await listProviders();
      if (!response.data?.providers) {
        throwApiError(response.error, 'Provider list response is missing data.');
      }
      return response.data.providers;
    },
    retry: false,
  });
  return {
    providerId: resolveSportProviderId(providersQuery.data, sport),
    isSuccess: providersQuery.isSuccess,
    isError: providersQuery.isError,
  };
}

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
export function useProviderCatalog(params: {
  enabled: boolean;
  sport: Sport;
  from?: string;
  search: string;
  sportLeagueId?: string;
  to?: string;
}) {
  const providersQuery = useSportProviderId(params.enabled, params.sport);
  const { providerId } = providersQuery;
  const trimmedSearch = params.search.trim();

  const catalogQuery = useQuery({
    enabled: params.enabled && providerId !== null,
    queryKey: QueryKeys.rootAdmin.providerCatalogEvents(
      providerId,
      params.sport,
      trimmedSearch,
      `${params.from ?? ''}|${params.to ?? ''}|${params.sportLeagueId ?? ''}`,
    ),
    queryFn: async (): Promise<ProviderCatalogEvent[]> => {
      if (!providerId) {
        throw new Error('No provider is configured for this sport.');
      }
      const response = await listProviderCatalogEvents({
        path: { providerId },
        query: {
          sport: params.sport,
          ...(params.sportLeagueId ? { sportLeagueId: params.sportLeagueId } : {}),
          ...(params.from ? { from: params.from } : {}),
          ...(params.to ? { to: params.to } : {}),
          ...(trimmedSearch ? { search: trimmedSearch } : {}),
        },
      });
      if (!response.data?.events) {
        throwApiError(response.error, 'Provider catalog response is missing data.');
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
