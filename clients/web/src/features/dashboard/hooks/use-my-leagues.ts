import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface League {
  id: string;
  name: string;
  memberCount: number;
  activeContestCount: number;
  role: 'Commissioner' | 'Member';
}

const mockLeagues: League[] = [
  {
    id: 'league-1',
    name: 'Weekend Warriors',
    memberCount: 12,
    activeContestCount: 1,
    role: 'Commissioner',
  },
  {
    id: 'league-2',
    name: 'Soccer Fanatics',
    memberCount: 8,
    activeContestCount: 1,
    role: 'Member',
  },
  {
    id: 'league-3',
    name: 'Hoops League',
    memberCount: 6,
    activeContestCount: 0,
    role: 'Member',
  },
];

export function useMyLeagues() {
  return useQuery({
    queryKey: ['dashboard', 'leagues'],
    queryFn: async (): Promise<League[]> => {
      try {
        return await api.get<League[]>('/v1/leagues');
      } catch {
        // Fallback to mock data when backend unavailable
        return mockLeagues;
      }
    },
  });
}
