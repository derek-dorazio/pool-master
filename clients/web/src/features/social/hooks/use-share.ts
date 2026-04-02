import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { socialKeys } from './query-keys';

export interface ShareCardData {
  id: string;
  type: 'contest_result' | 'season_champion' | 'achievement';
  title: string;
  sport: string;
  sportIcon: string;
  winnerName: string;
  winnerAvatarUrl: string | null;
  winnerScore: string;
  leaderboard: { rank: number; name: string; score: string }[];
  dateRange: string;
  imageUrl: string | null;
  ogTitle: string;
  ogDescription: string;
}

export function useShareCard(shareId: string) {
  return useQuery({
    queryKey: socialKeys.share(shareId),
    queryFn: async (): Promise<ShareCardData> => {
      // TODO: Add /v1/social/shares to API_ROUTES once backend endpoint exists
      return await api.get<ShareCardData>(`/v1/social/shares/${shareId}`);
    },
  });
}
