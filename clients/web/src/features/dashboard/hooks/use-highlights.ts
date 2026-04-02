import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/api';

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
      const { data, error } = await client.get<SeasonHighlights>({
        url: '/api/v1/history/highlights',
      });
      if (error) throw error;
      return data as SeasonHighlights;
    },
  });
}
