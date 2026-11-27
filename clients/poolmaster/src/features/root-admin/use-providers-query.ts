import { useQuery } from '@tanstack/react-query';
import { listProviders, type ProviderListResponse, type ProviderSettingRangesDto, type ProviderSummaryDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

async function readProviders(): Promise<ProviderListResponse> {
  const response = await listProviders();
  if (!response.data?.providers) {
    throwApiError(response.error, 'Provider list response is missing data.');
  }
  return response.data;
}

/** The data providers, the handful the sync pages and an event's score source choose from. */
export function useProvidersQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    enabled,
    queryKey: QueryKeys.rootAdmin.providers,
    queryFn: readProviders,
    select: (list): ProviderSummaryDto[] => list.providers,
    retry: false,
  });
}

/**
 * The ranges the API holds each provider setting to, from the same read as the provider list;
 * undefined until it has loaded.
 */
export function useProviderSettingRanges(): ProviderSettingRangesDto | undefined {
  const rangesQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.providers,
    queryFn: readProviders,
    select: (list): ProviderSettingRangesDto | undefined => list.settingRanges,
    retry: false,
  });
  return rangesQuery.data;
}
