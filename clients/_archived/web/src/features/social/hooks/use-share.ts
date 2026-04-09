import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/api';
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
      const { data, error } = await client.get<ShareCardData>({
        url: '/api/v1/social/shares/{shareId}',
        path: { shareId },
      });
      if (error) throw error;
      return data as ShareCardData;
    },
  });
}
