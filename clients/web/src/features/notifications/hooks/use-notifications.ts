import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { notificationKeys } from './query-keys';

export type NotificationCategory =
  | 'draft'
  | 'scoring'
  | 'contest'
  | 'league'
  | 'social'
  | 'account';

export interface Notification {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  read: boolean;
  targetUrl: string;
  createdAt: string;
}

interface NotificationPage {
  items: Notification[];
  nextCursor: string | null;
}

const mockNotifications: Notification[] = [
  {
    id: 'n-1',
    category: 'draft',
    title: 'Draft Starting Soon',
    body: 'Your NFL Fantasy Draft begins in 15 minutes. Tap to enter the draft room.',
    read: false,
    targetUrl: '/drafts/draft-1',
    createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
  {
    id: 'n-2',
    category: 'scoring',
    title: 'Score Update: Premier League Picks',
    body: 'Your entry moved up to 2nd place (+12 pts).',
    read: false,
    targetUrl: '/contests/contest-2/standings',
    createdAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
  },
  {
    id: 'n-3',
    category: 'league',
    title: 'New Member in Weekend Warriors',
    body: 'JaneDoe has joined your league.',
    read: false,
    targetUrl: '/leagues/league-1/members',
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'n-4',
    category: 'contest',
    title: 'Contest Results: March Madness Bracket',
    body: 'Final standings are in — you finished 1st!',
    read: true,
    targetUrl: '/contests/contest-3/results',
    createdAt: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'n-5',
    category: 'social',
    title: 'JohnDoe mentioned you',
    body: '"Great picks this week @Dave!"',
    read: true,
    targetUrl: '/leagues/league-1/feed',
    createdAt: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'n-6',
    category: 'contest',
    title: 'Entry Deadline: NFL Survivor Pool',
    body: 'Submissions close tomorrow at 1:00 PM EDT.',
    read: true,
    targetUrl: '/contests/contest-4',
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'n-7',
    category: 'account',
    title: 'Password Changed',
    body: 'Your account password was successfully updated.',
    read: true,
    targetUrl: '/settings/profile',
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export function useNotifications(category?: string) {
  return useInfiniteQuery({
    queryKey: notificationKeys.list(category),
    queryFn: async ({ pageParam }): Promise<NotificationPage> => {
      try {
        const params = new URLSearchParams({ limit: '20' });
        if (category) params.set('category', category);
        if (pageParam) params.set('cursor', pageParam);
        return await api.get<NotificationPage>(`/v1/notifications?${params.toString()}`);
      } catch {
        // Fallback to mock data when backend unavailable
        const filtered = category
          ? mockNotifications.filter((n) => n.category === category)
          : mockNotifications;
        return { items: filtered, nextCursor: null };
      }
    },
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}
