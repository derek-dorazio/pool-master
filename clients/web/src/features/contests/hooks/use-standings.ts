import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { clientPath, API_ROUTES } from '@poolmaster/shared/api-routes';

export interface StandingsEntry {
  id: string;
  rank: number;
  entryName: string;
  ownerName: string;
  totalScore: number;
  round1: number;
  round2: number;
  round3: number;
  round4: number;
  movement: 'up' | 'down' | 'none';
  movementAmount: number;
  isCurrentUser: boolean;
  isEliminated: boolean;
}

interface StandingsResponse {
  standings: StandingsEntry[];
  total: number;
  contestId: string;
}

export function useStandings(contestId: string | undefined) {
  return useQuery({
    queryKey: ['contests', contestId, 'standings'],
    queryFn: async (): Promise<StandingsResponse> => {
      return await api.get<StandingsResponse>(
        clientPath(API_ROUTES.contests.standings(contestId!)),
      );
    },
    enabled: !!contestId,
  });
}
