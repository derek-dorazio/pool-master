import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { notificationKeys } from './query-keys';

export interface UnreadCounts {
  total: number;
  grouped: Record<string, number>;
}

const mockUnreadCounts: UnreadCounts = {
  total: 3,
  grouped: {
    draft: 1,
    scoring: 1,
    league: 1,
    contest: 0,
    social: 0,
    account: 0,
  },
};

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: async (): Promise<UnreadCounts> => {
      // TODO: Replace with real API call
      // return api.get<UnreadCounts>('/notifications/unread-count?grouped=true');
      await new Promise((resolve) => setTimeout(resolve, 100));
      return mockUnreadCounts;
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
