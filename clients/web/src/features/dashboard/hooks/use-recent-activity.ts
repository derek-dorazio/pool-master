import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/api';

export type ActivityType =
  | 'score_update'
  | 'draft_pick'
  | 'announcement'
  | 'contest_completed'
  | 'member_joined';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  description: string;
  relativeTime: string;
  linkTo?: string;
}

export function useRecentActivity() {
  return useQuery({
    queryKey: ['dashboard', 'recent-activity'],
    queryFn: async (): Promise<ActivityItem[]> => {
      const { data, error } = await client.get<ActivityItem[] | { items: ActivityItem[] }>({
        url: '/api/v1/activity',
        query: { limit: '5' },
      });
      if (error) throw error;
      const payload = data as ActivityItem[] | { items?: ActivityItem[] } | undefined;
      if (!payload) return [];
      return Array.isArray(payload) ? payload : payload.items ?? [];
    },
  });
}
