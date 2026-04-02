import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/api';

export interface UpcomingDraft {
  id: string;
  name: string;
  leagueName: string;
  type: 'Snake' | 'Auction' | 'Linear';
  scheduledAt: string;
}

export function useUpcomingDrafts() {
  return useQuery({
    queryKey: ['dashboard', 'upcoming-drafts'],
    queryFn: async (): Promise<UpcomingDraft[]> => {
      const { data, error } = await client.get<UpcomingDraft[] | { drafts: UpcomingDraft[] }>({
        url: '/api/v1/drafts',
        query: { status: 'scheduled' },
      });
      if (error) throw error;
      return Array.isArray(data) ? data : (data as { drafts: UpcomingDraft[] }).drafts ?? [];
    },
  });
}
