import { useQuery } from '@tanstack/react-query';
import { client, typedData } from '@/lib/api-client-generated';
import { notificationKeys } from './query-keys';

export interface UnreadCounts {
  total: number;
  grouped: Record<string, number>;
}

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: async (): Promise<UnreadCounts> => {
      const result = await client.GET('/api/v1/notifications/unread-count');
      return typedData<UnreadCounts>(result);
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
