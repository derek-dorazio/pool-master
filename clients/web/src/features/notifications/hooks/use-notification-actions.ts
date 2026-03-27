import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { notificationKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';

export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      // TODO: Replace with real API call
      // return api.patch(`/notifications/${notificationId}/read`);
      await new Promise((resolve) => setTimeout(resolve, 100));
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
      // TODO: Replace with real API call
      // const params = category ? `?category=${category}` : '';
      // return api.patch(`/notifications/read-all${params}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      toast({ title: 'All notifications marked as read' });
    },
  });
}
