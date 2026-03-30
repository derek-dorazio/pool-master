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

const mockActiveContests: ActiveContest[] = [
  {
    id: 'contest-1',
    name: 'NFL Survivor Pool',
    sport: 'football',
    leagueName: 'Weekend Warriors',
    rank: 3,
    totalEntrants: 12,
    score: 47,
    delta: 5,
  },
  {
    id: 'contest-2',
    name: 'Premier League Picks',
    sport: 'soccer',
    leagueName: 'Soccer Fanatics',
    rank: 1,
    totalEntrants: 8,
    score: 82,
    delta: 0,
  },
];

export function useActiveContests() {
  return useQuery({
    queryKey: ['dashboard', 'active-contests'],
    queryFn: async (): Promise<ActiveContest[]> => {
      try {
        return await api.get<ActiveContest[]>('/v1/contests?status=active');
      } catch {
        // Fallback to mock data when backend unavailable
        return mockActiveContests;
      }
    },
    refetchInterval: 10_000,
  });
}
