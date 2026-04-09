import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DraftStateResponseSchema,
  DraftSearchResponseSchema,
  type DraftStateResponse,
} from '@poolmaster/shared/dto';
import { client, extendPickDeadline, getDraftState, pauseDraft, resumeDraft, searchPoolParticipants, submitDraftPick } from '@/lib/api';

export type DraftState = DraftStateResponse;
export type DraftEntry = DraftState['entries'][number];
export type DraftPick = DraftState['picks'][number];
export type DraftPickEmEvent = NonNullable<DraftState['pickEmEvents']>[number];
export type DraftBracketMatchup = NonNullable<DraftState['bracketMatchups']>[number];

export interface AvailableParticipant {
  id: string;
  name: string;
  position?: string;
  team?: string;
  ranking?: number;
  formRating: number;
  injuryStatus: string;
  price?: number;
  tier?: string;
  photoUrl?: string;
}

export function useDraft(draftId: string) {
  return useQuery({
    queryKey: ['drafts', draftId],
    queryFn: async () => {
      const { data, error } = await getDraftState({ client, path: { contestId: draftId } });
      if (error) throw error;
      return DraftStateResponseSchema.parse(data);
    },
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useAvailableParticipants(
  draftId: string,
  draftedParticipantIds: string[],
  filters: { query?: string; position?: string; sort?: string },
) {
  return useQuery({
    queryKey: ['drafts', draftId, 'available', draftedParticipantIds, filters],
    queryFn: async () => {
      const { data, error } = await searchPoolParticipants({
        client,
        path: { contestId: draftId },
        query: {
          q: filters.query,
          position: filters.position,
          undraftedOnly: 'true',
          availableOnly: 'true',
          draftedIds: draftedParticipantIds.length > 0 ? draftedParticipantIds.join(',') : undefined,
          limit: '100',
          offset: '0',
        },
      });
      if (error) throw error;
      const parsed = DraftSearchResponseSchema.parse(data);
      let participants = parsed.participants.map((participant) => ({
        id: participant.participantId,
        name: participant.displayName,
        position: participant.position,
        team: participant.teamAffiliation,
        ranking: participant.ranking,
        formRating: participant.ranking ?? 0,
        injuryStatus: participant.injuryStatus.status,
        price: participant.budgetPrice,
        tier: participant.tier,
        photoUrl: participant.photoUrl,
      }));

      if (filters.sort === 'name') {
        participants = [...participants].sort((a, b) => a.name.localeCompare(b.name));
      } else if (filters.sort === 'price') {
        participants = [...participants].sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER));
      } else if (filters.sort === 'form') {
        participants = [...participants].sort((a, b) => b.formRating - a.formRating);
      } else {
        participants = [...participants].sort((a, b) => (a.ranking ?? Number.MAX_SAFE_INTEGER) - (b.ranking ?? Number.MAX_SAFE_INTEGER));
      }

      return participants;
    },
  });
}

export function useMakePick(draftId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      entryId: string;
      participantId: string;
      eventId?: string;
      period?: number;
      matchupIndex?: number;
      roundNumber?: number;
      matchNumber?: number;
      confidenceWeight?: number;
    }) => {
      const usesExtendedFields = payload.eventId != null
        || payload.period != null
        || payload.matchupIndex != null
        || payload.roundNumber != null
        || payload.matchNumber != null
        || payload.confidenceWeight != null;

      const result = usesExtendedFields
        ? await client.post({
            url: `/api/v1/drafts/${draftId}/pick`,
            body: payload,
          })
        : await submitDraftPick({
            client,
            path: { contestId: draftId },
            body: { entryId: payload.entryId, participantId: payload.participantId },
          });

      const error = 'error' in result ? result.error : undefined;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId, 'available'] });
    },
  });
}

export function useResetBracket(draftId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const result = await client.delete({
        url: `/api/v1/drafts/${draftId}/bracket`,
      });
      if (result.error) throw result.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId] });
    },
  });
}

export function useAutoFillBracket(draftId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const result = await client.post({
        url: `/api/v1/drafts/${draftId}/bracket/auto-fill`,
      });
      if (result.error) throw result.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId] });
    },
  });
}

export function usePauseDraft(draftId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await pauseDraft({
        client,
        path: { contestId: draftId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId] });
    },
  });
}

export function useResumeDraft(draftId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await resumeDraft({
        client,
        path: { contestId: draftId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId] });
    },
  });
}

export function useExtendDraft(draftId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (additionalSeconds: number) => {
      const { error } = await extendPickDeadline({
        client,
        path: { contestId: draftId },
        body: { additionalSeconds },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId] });
    },
  });
}

export function useUndoDraft(draftId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const result = await client.post({
        url: `/api/v1/drafts/${draftId}/undo`,
      });
      if (result.error) throw result.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId, 'available'] });
    },
  });
}

export function useSkipDraft(draftId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const result = await client.post({
        url: `/api/v1/drafts/${draftId}/skip`,
      });
      if (result.error) throw result.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId, 'available'] });
    },
  });
}
