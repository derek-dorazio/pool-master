import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { clientPath, API_ROUTES } from '@poolmaster/shared/api-routes';

export interface League {
  id: string;
  name: string;
  memberCount: number;
  activeContestCount: number;
  role: 'Commissioner' | 'Member';
}

export function useMyLeagues() {
  return useQuery({
    queryKey: ['dashboard', 'leagues'],
    queryFn: async (): Promise<League[]> => {
      const res = await api.get<{ leagues: League[] }>(clientPath(API_ROUTES.leagues.list));
      return res.leagues;
    },
  });
}
