import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DraftMode, DraftStatus } from '@poolmaster/shared/domain';
import { api } from '@/lib/api-client';
import { client, typedData } from '@/lib/api-client-generated';

export interface DraftState {
  id: string;
  contestId: string;
  contestName: string;
  leagueName: string;
  sport: string;
  draftType: 'SNAKE' | 'AUCTION' | 'TIERED' | 'PICK_EM' | 'BRACKET';
  mode: DraftMode;
  status: DraftStatus;
  currentPickNumber: number;
  totalPicks: number;
  currentRound: number;
  totalRounds: number;
  currentEntryId: string | null;
  currentEntryName: string | null;
  isMyPick: boolean;
  timePerPickSeconds: number;
  pickDeadline: string | null;
  entries: DraftEntry[];
  picks: DraftPick[];
}

export interface DraftEntry {
  id: string;
  name: string;
  userId: string;
  isCommissioner: boolean;
  pickOrder: number;
}

export interface DraftPick {
  pickNumber: number;
  round: number;
  pickInRound: number;
  entryId: string;
  entryName: string;
  participantId: string;
  participantName: string;
  position?: string;
  team?: string;
  autoPicked: boolean;
}

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
      const result = await client.GET('/api/v1/drafts/{contestId}', {
        params: { path: { contestId: draftId } },
      });
      return typedData<DraftState>(result);
    },
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useAvailableParticipants(draftId: string, filters: { query?: string; position?: string; sort?: string }) {
  return useQuery({
    queryKey: ['drafts', draftId, 'available', filters],
    queryFn: () => {
      // TODO: migrate to generated client when backend adds this endpoint to OpenAPI spec
      const params = new URLSearchParams();
      if (filters.query) params.set('q', filters.query);
      if (filters.position) params.set('position', filters.position);
      if (filters.sort) params.set('sort', filters.sort);
      return api.get<AvailableParticipant[]>(`/v1/drafts/${draftId}/available?${params.toString()}`);
    },
  });
}

export function useMakePick(draftId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (participantId: string) => {
      const result: any = await client.POST('/api/v1/drafts/{contestId}/pick', {
        params: { path: { contestId: draftId } },
        body: { participantId } as never,
      });
      if (result.error) throw result.error;
      if (!result.response.ok) throw new Error(`Request failed: ${result.response.status}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId, 'available'] });
    },
  });
}
