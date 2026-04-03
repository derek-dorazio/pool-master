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
      const payload = data as ActiveContest[] | { contests?: ActiveContest[] } | undefined;
      if (!payload) return [];
      return Array.isArray(payload) ? payload : payload.contests ?? [];
    },
    refetchInterval: 10_000,
  });
}
