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
      // TODO: migrate to client.GET when /api/v1/history/highlights is in the OpenAPI spec
      return await api.get<SeasonHighlights>('/v1/history/highlights');
    },
  });
}
