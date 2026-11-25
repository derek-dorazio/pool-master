import { useQuery } from '@tanstack/react-query';
import {
  changeProviderSyncFindingStatus,
  getProviderSyncFinding,
  linkProviderSyncFindingSlot,
  listProviderSyncFindings,
  listProviderSyncFindingSlotChoices,
  mapProviderSyncFindingParticipant,
  type ChangeProviderSyncFindingStatusRequest,
  type ProviderSyncFindingDto,
  type ProviderSyncFindingSlotChoiceDto,
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

/** The slots a tournament name finding can be linked to (#2011), read when "link to existing" opens. */
export function useSyncFindingSlotChoicesQuery(findingId: string, enabled: boolean) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.syncFindingSlotChoices(findingId),
    queryFn: async (): Promise<ProviderSyncFindingSlotChoiceDto[]> => {
      const response = await listProviderSyncFindingSlotChoices({ path: { findingId } });
      if (!response.data?.slots) throwApiError(response.error, 'Slot choices response is missing data.');
      return response.data.slots;
    },
    enabled: enabled && findingId !== '',
    retry: false,
  });
}

/** Adds a tournament name finding's name as a pattern of a slot, which resolves it (#2011). */
export function useLinkSyncFindingSlot(findingId: string, options: { onSuccess?: (finding: ProviderSyncFindingDto) => void } = {}) {
  return useInvalidatingMutation({
    mutationFn: async (slotDefinitionId: string): Promise<ProviderSyncFindingDto> => {
      const response = await linkProviderSyncFindingSlot({ path: { findingId }, body: { slotDefinitionId } });
      if (!response.data?.finding) throwApiError(response.error, 'Slot link response is missing data.');
      return response.data.finding;
    },
    invalidates: [...FINDING_CHANGE_INVALIDATES, QueryKeys.rootAdmin.syncFindingSlotChoices(findingId), QueryKeys.rootAdmin.manageSport.leagues],
    onSuccess: options.onSuccess,
  });
}
