import { useQuery } from '@tanstack/react-query';

export interface League {
  id: string;
  name: string;
  sport: string;
  memberCount: number;
  activeContestCount: number;
  role: 'Commissioner' | 'Member';
}

const mockLeagues: League[] = [
  {
    id: 'league-1',
    name: 'Weekend Warriors',
    sport: 'football',
    memberCount: 12,
    activeContestCount: 1,
    role: 'Commissioner',
  },
  {
    id: 'league-2',
    name: 'Soccer Fanatics',
    sport: 'soccer',
    memberCount: 8,
    activeContestCount: 1,
    role: 'Member',
  },
  {
    id: 'league-3',
    name: 'Hoops League',
    sport: 'basketball',
    memberCount: 6,
    activeContestCount: 0,
    role: 'Member',
  },
];

export function useMyLeagues() {
  return useQuery({
    queryKey: ['dashboard', 'leagues'],
    queryFn: async (): Promise<League[]> => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return mockLeagues;
    },
  });
}
