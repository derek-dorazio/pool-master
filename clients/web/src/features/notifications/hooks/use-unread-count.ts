import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { clientPath, API_ROUTES } from '@poolmaster/shared/api-routes';
import { notificationKeys } from './query-keys';

export interface UnreadCounts {
  total: number;
  grouped: Record<string, number>;
}

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: async (): Promise<UnreadCounts> => {
      return await api.get<UnreadCounts>(
        `${clientPath(API_ROUTES.notifications.list)}/unread-count`,
      );
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
