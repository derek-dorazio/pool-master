import { useQuery } from '@tanstack/react-query';
import { client, getStandings } from '@/lib/api';

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
      const { data, error } = await getStandings({ client, path: { contestId: contestId! } });
      if (error) throw error;
      return data as unknown as StandingsResponse;
    },
    enabled: !!contestId,
  });
}
