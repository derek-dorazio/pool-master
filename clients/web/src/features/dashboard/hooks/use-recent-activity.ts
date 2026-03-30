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

const mockActivityItems: ActivityItem[] = [
  {
    id: 'activity-1',
    type: 'score_update',
    description: 'Your score in NFL Survivor Pool updated to 47 pts',
    relativeTime: '5 minutes ago',
    linkTo: '/contests/contest-1',
  },
  {
    id: 'activity-2',
    type: 'draft_pick',
    description: 'You drafted LeBron James in Hoops League',
    relativeTime: '2 hours ago',
    linkTo: '/drafts/draft-1',
  },
  {
    id: 'activity-3',
    type: 'announcement',
    description: 'Weekend Warriors: Playoff bracket posted',
    relativeTime: '1 day ago',
    linkTo: '/leagues/league-1',
  },
  {
    id: 'activity-4',
    type: 'contest_completed',
    description: 'Premier League Matchday 28 completed — you finished 1st!',
    relativeTime: '2 days ago',
    linkTo: '/contests/contest-2',
  },
  {
    id: 'activity-5',
    type: 'member_joined',
    description: 'Alex Rivera joined Soccer Fanatics',
    relativeTime: '3 days ago',
    linkTo: '/leagues/league-2',
  },
];

export function useRecentActivity() {
  return useQuery({
    queryKey: ['dashboard', 'recent-activity'],
    queryFn: async (): Promise<ActivityItem[]> => {
      try {
        return await api.get<ActivityItem[]>('/v1/activity?limit=5');
      } catch {
        // Fallback to mock data when backend unavailable
        return mockActivityItems;
      }
    },
  });
}
