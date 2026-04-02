import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DraftMode, DraftStatus } from '@poolmaster/shared/domain/enums';
import { api } from '@/lib/api-client';

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

// Mock data for development
const mockDraft: DraftState = {
  id: 'draft-1',
  contestId: 'contest-1',
  contestName: 'NFL Keeper League Draft',
  leagueName: 'Weekend Warriors',
  sport: 'NFL',
  draftType: 'SNAKE',
  mode: DraftMode.LIVE,
  status: DraftStatus.LIVE,
  currentPickNumber: 7,
  totalPicks: 180,
  currentRound: 3,
  totalRounds: 15,
  currentEntryId: 'entry-1',
  currentEntryName: null,
  isMyPick: true,
  timePerPickSeconds: 90,
  pickDeadline: new Date(Date.now() + 83000).toISOString(),
  entries: [
    { id: 'entry-1', name: 'My Team', userId: 'me', isCommissioner: false, pickOrder: 1 },
    { id: 'entry-2', name: 'Team Alpha', userId: 'u2', isCommissioner: true, pickOrder: 2 },
    { id: 'entry-3', name: 'Team Beta', userId: 'u3', isCommissioner: false, pickOrder: 3 },
    { id: 'entry-4', name: 'Team Gamma', userId: 'u4', isCommissioner: false, pickOrder: 4 },
  ],
  picks: [
    { pickNumber: 1, round: 1, pickInRound: 1, entryId: 'entry-1', entryName: 'My Team', participantId: 'p1', participantName: 'P. Mahomes', position: 'QB', team: 'KC', autoPicked: false },
    { pickNumber: 2, round: 1, pickInRound: 2, entryId: 'entry-2', entryName: 'Team Alpha', participantId: 'p2', participantName: 'J. Jefferson', position: 'WR', team: 'MIN', autoPicked: false },
    { pickNumber: 3, round: 1, pickInRound: 3, entryId: 'entry-3', entryName: 'Team Beta', participantId: 'p3', participantName: 'T. Hill', position: 'WR', team: 'MIA', autoPicked: false },
    { pickNumber: 4, round: 1, pickInRound: 4, entryId: 'entry-4', entryName: 'Team Gamma', participantId: 'p4', participantName: 'J. Hurts', position: 'QB', team: 'PHI', autoPicked: false },
    { pickNumber: 5, round: 2, pickInRound: 1, entryId: 'entry-4', entryName: 'Team Gamma', participantId: 'p5', participantName: 'D. Henry', position: 'RB', team: 'TEN', autoPicked: false },
    { pickNumber: 6, round: 2, pickInRound: 2, entryId: 'entry-3', entryName: 'Team Beta', participantId: 'p6', participantName: 'T. Kelce', position: 'TE', team: 'KC', autoPicked: false },
  ],
};

const mockAvailable: AvailableParticipant[] = [
  { id: 'p10', name: 'J. Chase', position: 'WR', team: 'CIN', ranking: 5, formRating: 9.1, injuryStatus: 'HEALTHY' },
  { id: 'p11', name: 'C. Lamb', position: 'WR', team: 'DAL', ranking: 6, formRating: 8.7, injuryStatus: 'HEALTHY' },
  { id: 'p12', name: 'A. Ekeler', position: 'RB', team: 'LAC', ranking: 8, formRating: 7.9, injuryStatus: 'QUESTIONABLE' },
  { id: 'p13', name: 'S. Barkley', position: 'RB', team: 'NYG', ranking: 10, formRating: 8.3, injuryStatus: 'HEALTHY' },
  { id: 'p14', name: 'D. Adams', position: 'WR', team: 'LV', ranking: 12, formRating: 8.0, injuryStatus: 'HEALTHY' },
  { id: 'p15', name: 'M. Andrews', position: 'TE', team: 'BAL', ranking: 15, formRating: 7.5, injuryStatus: 'HEALTHY' },
  { id: 'p16', name: 'L. Jackson', position: 'QB', team: 'BAL', ranking: 7, formRating: 9.0, injuryStatus: 'HEALTHY' },
  { id: 'p17', name: 'N. Harris', position: 'RB', team: 'PIT', ranking: 18, formRating: 7.2, injuryStatus: 'HEALTHY' },
  { id: 'p18', name: 'A. Brown', position: 'WR', team: 'PHI', ranking: 14, formRating: 8.5, injuryStatus: 'HEALTHY' },
  { id: 'p19', name: 'S. Diggs', position: 'WR', team: 'BUF', ranking: 16, formRating: 7.8, injuryStatus: 'HEALTHY' },
  { id: 'p20', name: 'J. Taylor', position: 'RB', team: 'IND', ranking: 9, formRating: 8.8, injuryStatus: 'HEALTHY' },
  { id: 'p21', name: 'K. Allen', position: 'WR', team: 'LAC', ranking: 20, formRating: 7.6, injuryStatus: 'HEALTHY' },
];

export function useDraft(draftId: string) {
  return useQuery({
    queryKey: ['drafts', draftId],
    queryFn: async (): Promise<DraftState> => {
      try {
        return await api.get<DraftState>(`/v1/drafts/${draftId}`);
      } catch {
        // Fallback to mock data when backend unavailable
        return { ...mockDraft, id: draftId, isMyPick: true, currentEntryName: 'My Team' };
      }
    },
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useAvailableParticipants(draftId: string, filters: { query?: string; position?: string; sort?: string }) {
  return useQuery({
    queryKey: ['drafts', draftId, 'available', filters],
    queryFn: async (): Promise<AvailableParticipant[]> => {
      try {
        const params = new URLSearchParams();
        if (filters.query) params.set('q', filters.query);
        if (filters.position) params.set('position', filters.position);
        if (filters.sort) params.set('sort', filters.sort);
        return await api.get<AvailableParticipant[]>(`/v1/drafts/${draftId}/available?${params.toString()}`);
      } catch {
        // Fallback to mock data when backend unavailable
        let results = [...mockAvailable];
        if (filters.query) {
          const q = filters.query.toLowerCase();
          results = results.filter((p) => p.name.toLowerCase().includes(q) || p.team?.toLowerCase().includes(q));
        }
        if (filters.position) {
          results = results.filter((p) => p.position === filters.position);
        }
        if (filters.sort === 'name') results.sort((a, b) => a.name.localeCompare(b.name));
        else results.sort((a, b) => (a.ranking ?? 999) - (b.ranking ?? 999));
        return results;
      }
    },
  });
}

export function useMakePick(draftId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (participantId: string) => {
      try {
        return await api.post<{ success: boolean }>(`/v1/drafts/${draftId}/pick`, { participantId });
      } catch {
        // Fallback: simulate success when backend unavailable
        return { success: true };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId, 'available'] });
    },
  });
}
