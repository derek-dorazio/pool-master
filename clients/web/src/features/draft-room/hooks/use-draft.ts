import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DraftMode, DraftStatus } from '@poolmaster/shared/domain';
import { client, getDraftState } from '@/lib/api';

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
      const { data, error } = await getDraftState({ client, path: { contestId: draftId } });
      if (error) throw error;
      return data as unknown as DraftState;
    },
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useAvailableParticipants(draftId: string, filters: { query?: string; position?: string; sort?: string }) {
  return useQuery({
    queryKey: ['drafts', draftId, 'available', filters],
    queryFn: async () => {
      const query: Record<string, string> = {};
      if (filters.query) query.q = filters.query;
      if (filters.position) query.position = filters.position;
      if (filters.sort) query.sort = filters.sort;
      const { data, error } = await client.get<AvailableParticipant[]>({
        url: '/api/v1/drafts/{contestId}/available',
        path: { contestId: draftId },
        query,
      });
      if (error) throw error;
      return data as AvailableParticipant[];
    },
  });
}

export function useMakePick(draftId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (participantId: string) => {
      const { error } = await client.post({
        url: '/api/v1/drafts/{contestId}/pick',
        path: { contestId: draftId },
        body: { participantId },
        headers: { 'Content-Type': 'application/json' },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId, 'available'] });
    },
  });
}
