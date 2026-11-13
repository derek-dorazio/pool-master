import { useQuery } from '@tanstack/react-query';
import { listProviders, type ProviderSummaryDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** The data providers, the handful the sync pages and an event's score source choose from. */
export function useProvidersQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    enabled,
    queryKey: QueryKeys.rootAdmin.providers,
    queryFn: async (): Promise<ProviderSummaryDto[]> => {
      const response = await listProviders();
      if (!response.data?.providers) {
        throwApiError(response.error, 'Provider list response is missing data.');
      }
      return response.data.providers;
    },
    retry: false,
  });
}

/**
 * A provider's display name ("BALLDONTLIE"), read only while `enabled`; its id until the provider
 * list has loaded, or when the list does not hold it.
 */
export function useProviderName(providerId: string, { enabled = true }: { enabled?: boolean } = {}): string {
  const providersQuery = useProvidersQuery({ enabled });
  // poolmaster-allow-list-lookup: the handful of registered providers, read once
  return providersQuery.data?.find((provider) => provider.providerId === providerId)?.providerName ?? providerId;
}
