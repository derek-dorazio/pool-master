import { useQuery } from '@tanstack/react-query';
import { listUnmappedProviderParticipants, type UnmappedProviderParticipantDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** Competitors a provider reports that no participant is mapped to. */
export function useUnmappedCompetitorsQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.unmappedProviderParticipants,
    queryFn: async (): Promise<UnmappedProviderParticipantDto[]> => {
      const response = await listUnmappedProviderParticipants();
      if (!response.data?.participants) {
        throwApiError(response.error, 'Unmapped competitor response is missing data.');
      }
      return response.data.participants;
    },
    retry: false,
  });
}

/**
 * One competitor, while no participant is mapped to it: the list filtered on the server by
 * provider and the provider's id, so only that provider is asked (#1251). Null once mapped, or
 * when the provider no longer reports it.
 */
export function useUnmappedCompetitorQuery(providerId: string, externalId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.unmappedProviderParticipant(providerId, externalId),
    queryFn: async (): Promise<UnmappedProviderParticipantDto | null> => {
      const response = await listUnmappedProviderParticipants({ query: { providerId, externalId } });
      if (!response.data?.participants) {
        throwApiError(response.error, 'Unmapped competitor response is missing data.');
      }
      return response.data.participants.at(0) ?? null;
    },
    enabled: providerId !== '' && externalId !== '',
    retry: false,
  });
}
