import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

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
      // TODO: add API_ROUTES.drafts.scheduled when backend endpoint exists
      return await api.get<UpcomingDraft[]>('/v1/drafts?status=scheduled');
    },
  });
}
