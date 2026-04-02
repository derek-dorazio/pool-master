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
      // TODO: add API_ROUTES.activity.recent when backend endpoint exists
      return await api.get<ActivityItem[]>('/v1/activity?limit=5');
    },
  });
}
