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
      // TODO: migrate to client.GET when /api/v1/drafts?status=scheduled is in the OpenAPI spec
      const res = await api.get<UpcomingDraft[] | { drafts: UpcomingDraft[] }>('/v1/drafts?status=scheduled');
      return Array.isArray(res) ? res : res.drafts ?? [];
    },
  });
}
