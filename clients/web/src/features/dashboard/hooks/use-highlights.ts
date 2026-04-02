import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface SeasonHighlights {
  recentWin: string | null;
  personalBest: number;
  currentStreak: number;
  seasonRecord: { wins: number; losses: number };
}

export function useHighlights() {
  return useQuery({
    queryKey: ['dashboard', 'highlights'],
    queryFn: async (): Promise<SeasonHighlights> => {
      // TODO: add API_ROUTES.history.highlights when backend endpoint exists
      return await api.get<SeasonHighlights>('/v1/history/highlights');
    },
  });
}
