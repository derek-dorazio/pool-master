import { useQuery } from '@tanstack/react-query';
import {
  changeProviderSyncFindingStatus,
  getProviderSyncFinding,
  listProviderSyncFindings,
  mapProviderSyncFindingParticipant,
  type ChangeProviderSyncFindingStatusRequest,
  type ProviderSyncFindingDto,
} from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';

/** What a change to a finding refreshes: the findings, and the Sports page's counts of them. */
const FINDING_CHANGE_INVALIDATES = [QueryKeys.rootAdmin.syncFindings, QueryKeys.rootAdmin.manageSport.overviews] as const;

/** Every sync finding kept (#1999), read whole and filtered in the grid. */
export function useSyncFindingsQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.syncFindings,
    queryFn: async (): Promise<ProviderSyncFindingDto[]> => {
      const response = await listProviderSyncFindings();
      if (!response.data?.findings) throwApiError(response.error, 'Sync finding list response is missing data.');
      return response.data.findings;
    },
    retry: false,
  });
}

/** One sync finding, as the map participant page reads it. */
export function useSyncFindingQuery(findingId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.syncFinding(findingId),
    queryFn: async (): Promise<ProviderSyncFindingDto> => {
      const response = await getProviderSyncFinding({ path: { findingId } });
      if (!response.data?.finding) throwApiError(response.error, 'Sync finding response is missing data.');
      return response.data.finding;
    },
    enabled: findingId !== '',
    retry: false,
  });
}

/** Resolves, waives (with a note) or reopens a finding. */
export function useChangeSyncFindingStatus(findingId: string, options: { onSuccess?: (finding: ProviderSyncFindingDto) => void } = {}) {
  return useInvalidatingMutation({
    mutationFn: async (body: ChangeProviderSyncFindingStatusRequest): Promise<ProviderSyncFindingDto> => {
      const response = await changeProviderSyncFindingStatus({ path: { findingId }, body });
      if (!response.data?.finding) throwApiError(response.error, 'Sync finding status response is missing data.');
      return response.data.finding;
    },
    invalidates: FINDING_CHANGE_INVALIDATES,
    onSuccess: options.onSuccess,
  });
}

/** Maps an unmapped participant finding's feed id to a participant, which resolves it. */
export function useMapSyncFindingParticipant(findingId: string, options: { onSuccess?: (finding: ProviderSyncFindingDto) => void } = {}) {
  return useInvalidatingMutation({
    mutationFn: async (participantId: string): Promise<ProviderSyncFindingDto> => {
      const response = await mapProviderSyncFindingParticipant({ path: { findingId }, body: { participantId } });
      if (!response.data?.finding) throwApiError(response.error, 'Participant mapping response is missing data.');
      return response.data.finding;
    },
    invalidates: [...FINDING_CHANGE_INVALIDATES, QueryKeys.rootAdmin.manageSport.participants],
    onSuccess: options.onSuccess,
  });
}
