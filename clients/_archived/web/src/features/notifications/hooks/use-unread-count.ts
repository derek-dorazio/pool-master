import { useQuery } from '@tanstack/react-query';
import { client, getUnreadNotificationCount } from '@/lib/api';
import { notificationKeys } from './query-keys';

export interface UnreadCounts {
  total: number;
  grouped: Record<string, number>;
}

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: async (): Promise<UnreadCounts> => {
      const { data, error } = await getUnreadNotificationCount({ client });
      if (error) throw error;
      return data as unknown as UnreadCounts;
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
