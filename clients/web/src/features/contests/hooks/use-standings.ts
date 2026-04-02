import { useQuery } from '@tanstack/react-query';
import { client, typedData } from '@/lib/api-client-generated';

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
      const result = await client.GET('/api/v1/contests/{contestId}/standings/', {
        params: { path: { contestId: contestId! } },
      });
      return typedData<StandingsResponse>(result);
    },
    enabled: !!contestId,
  });
}
