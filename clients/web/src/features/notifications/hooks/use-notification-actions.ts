import { useMutation, useQueryClient } from '@tanstack/react-query';
import { client, markNotificationRead } from '@/lib/api';
import { notificationKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';

export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await markNotificationRead({ client, path: { id: notificationId } });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

export function useMarkAllAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (category?: string) => {
      const { error } = await client.put({
        url: '/api/v1/notifications/read-all',
        ...(category ? { query: { category } } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      toast({ title: 'All notifications marked as read' });
    },
  });
}
