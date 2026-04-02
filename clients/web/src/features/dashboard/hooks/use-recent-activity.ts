import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

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
      // TODO: migrate to client.GET when /api/v1/activity?limit=5 is in the OpenAPI spec
      const res = await api.get<ActivityItem[] | { items: ActivityItem[] }>('/v1/activity?limit=5');
      return Array.isArray(res) ? res : res.items ?? [];
    },
  });
}
