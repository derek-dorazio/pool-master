import { useInfiniteQuery } from '@tanstack/react-query';
import { client } from '@/lib/api';
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

export function useNotifications(category?: string) {
  return useInfiniteQuery({
    queryKey: notificationKeys.list(category),
    queryFn: async ({ pageParam }): Promise<NotificationPage> => {
      const query: Record<string, string> = { limit: '20' };
      if (category) query.category = category;
      if (pageParam) query.cursor = pageParam;
      const { data, error } = await client.get<NotificationPage>({
        url: '/api/v1/notifications',
        query,
      });
      if (error) throw error;
      return data as NotificationPage;
    },
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}
