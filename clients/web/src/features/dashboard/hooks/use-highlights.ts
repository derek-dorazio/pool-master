import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface SeasonHighlights {
  recentWin: string | null;
  personalBest: number;
  currentStreak: number;
  seasonRecord: { wins: number; losses: number };
}

const mockHighlights: SeasonHighlights = {
  recentWin: 'Premier League Matchday 28',
  personalBest: 142,
  currentStreak: 3,
  seasonRecord: { wins: 7, losses: 3 },
};

export function useHighlights() {
  return useQuery({
    queryKey: ['dashboard', 'highlights'],
    queryFn: async (): Promise<SeasonHighlights> => {
      try {
        return await api.get<SeasonHighlights>('/v1/history/highlights');
      } catch {
        // Fallback to mock data when backend unavailable
        return mockHighlights;
      }
    },
  });
}
