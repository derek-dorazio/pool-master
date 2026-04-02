import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/api';

export interface ActiveContest {
  id: string;
  name: string;
  sport: string;
  leagueName: string;
  rank: number;
  totalEntrants: number;
  score: number;
  delta: number;
}

export function useActiveContests() {
  return useQuery({
    queryKey: ['dashboard', 'active-contests'],
    queryFn: async (): Promise<ActiveContest[]> => {
      const { data, error } = await client.get<ActiveContest[] | { contests: ActiveContest[] }>({
        url: '/api/v1/contests',
        query: { status: 'active' },
      });
      if (error) throw error;
      return Array.isArray(data) ? data : (data as { contests: ActiveContest[] }).contests ?? [];
    },
    refetchInterval: 10_000,
  });
}
