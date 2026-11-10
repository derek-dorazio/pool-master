import type { Sport } from '@poolmaster/shared/domain';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { listProviderCatalogEvents } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import type { ProviderEventDto } from '@/lib/api';
import { sportProviderOptions } from './sport-admin-utils';
import { throwApiError } from '@/lib/errors';
import { useProvidersQuery } from './use-providers-query';

export type ProviderCatalogEvent = ProviderEventDto;

/**
 * The providers covering a sport (its primary first) and the one chosen, which starts as the
 * primary; null when none covers it, as for horse racing today. Shared by the catalog browse
 * below and the sport league year import (#385). Choosing matters only where two providers
 * cover the sport, as the QA mock and BALLDONTLIE do for golf (#1495).
 */
export function useSportProviderId(enabled: boolean, sport: Sport) {
  const providersQuery = useProvidersQuery({ enabled });
  const [chosenProviderId, setProviderId] = useState<string | null>(null);
  const providers = sportProviderOptions(providersQuery.data, sport);
  const chosen = providers.find((provider) => provider.providerId === chosenProviderId) ?? providers.at(0);
  return {
    providerId: chosen?.providerId ?? null,
    providers,
    setProviderId,
    isSuccess: providersQuery.isSuccess,
    isError: providersQuery.isError,
  };
}

/**
 * plans/124 §4.4 — one place that resolves "the" golf provider and browses its
 * live event catalog. Shared by the tournament-creation "Browse provider events"
 * mode and the Tournament Home score-source link picker so they can't drift.
 *
 * The provider is resolved client-side from the provider-health list (the
 * sport's primary unless another covering provider is chosen) because there is
 * no dedicated "provider for this sport" endpoint.
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
    providers: providersQuery.providers,
    setProviderId: providersQuery.setProviderId,
    providersLoaded: providersQuery.isSuccess,
    providersError: providersQuery.isError,
    events: catalogQuery.data ?? [],
    isLoading: catalogQuery.isLoading,
    isError: catalogQuery.isError,
    error: catalogQuery.error,
  };
}
