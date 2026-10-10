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
