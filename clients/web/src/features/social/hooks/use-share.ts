import { useQuery } from '@tanstack/react-query';
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

const mockShareData: ShareCardData = {
  id: 'share-1', type: 'contest_result', title: 'NFL Survivor Pool 2026', sport: 'NFL', sportIcon: '🏈',
  winnerName: 'Mike Thompson', winnerAvatarUrl: null, winnerScore: '145 points',
  leaderboard: [
    { rank: 1, name: 'Mike Thompson', score: '145 pts' },
    { rank: 2, name: 'Sarah Kim', score: '132 pts' },
    { rank: 3, name: 'John Doe', score: '128 pts' },
  ],
  dateRange: 'Sep 7 — Jan 12, 2026', imageUrl: null,
  ogTitle: 'Mike won the NFL Survivor Pool!', ogDescription: 'Score: 145 pts — Can you beat it?',
};

export function useShareCard(shareId: string) {
  return useQuery({
    queryKey: socialKeys.share(shareId),
    queryFn: async (): Promise<ShareCardData> => {
      // TODO: return api.get(`/api/shares/${shareId}`);
      await new Promise((r) => setTimeout(r, 200));
      return mockShareData;
    },
  });
}
