import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { clientPath, API_ROUTES } from '@poolmaster/shared/api-routes';
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
      const params = new URLSearchParams({ limit: '20' });
      if (category) params.set('category', category);
      if (pageParam) params.set('cursor', pageParam);
      return await api.get<NotificationPage>(
        `${clientPath(API_ROUTES.notifications.list)}?${params.toString()}`,
      );
    },
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}
