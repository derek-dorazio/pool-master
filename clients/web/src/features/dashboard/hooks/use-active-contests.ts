import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

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
      // TODO: add API_ROUTES.contests.active when backend endpoint exists
      const res = await api.get<ActiveContest[] | { contests: ActiveContest[] }>('/v1/contests?status=active');
      return Array.isArray(res) ? res : res.contests ?? [];
    },
    refetchInterval: 10_000,
  });
}
