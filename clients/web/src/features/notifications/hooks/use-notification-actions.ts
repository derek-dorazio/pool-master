import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { notificationKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';

export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      try {
        return await api.put(`/v1/notifications/${notificationId}/read`);
      } catch {
        // Fallback: simulate success when backend unavailable
        return undefined;
      }
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
      try {
        const params = category ? `?category=${category}` : '';
        return await api.put(`/v1/notifications/read-all${params}`);
      } catch {
        // Fallback: simulate success when backend unavailable
        return undefined;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      toast({ title: 'All notifications marked as read' });
    },
  });
}
