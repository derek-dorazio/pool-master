import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client, getNotificationPreferences } from '@/lib/api';
import { notificationKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';

export interface CategoryPreference {
  inApp: boolean;
  push: boolean;
  email: boolean;
}

export interface DndSettings {
  enabled: boolean;
  startTime: string;
  endTime: string;
  timezone: string;
}

export interface NotificationPreferences {
  categories: Record<string, CategoryPreference>;
  dnd: DndSettings;
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences(),
    queryFn: async (): Promise<NotificationPreferences> => {
      const { data, error } = await getNotificationPreferences({ client });
      if (error) throw error;
      return data as unknown as NotificationPreferences;
    },
  });
}

export function useSaveNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (preferences: NotificationPreferences) => {
      const { error } = await client.put({
        url: '/api/v1/notifications/preferences',
        body: preferences,
        headers: { 'Content-Type': 'application/json' },
      });
      if (error) throw error;
    },
    onMutate: async (newPreferences) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.preferences() });
      const previous = queryClient.getQueryData<NotificationPreferences>(notificationKeys.preferences());
      queryClient.setQueryData(notificationKeys.preferences(), newPreferences);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(notificationKeys.preferences(), context.previous);
      }
      toast({ title: 'Failed to save preferences', description: 'Please try again.' });
    },
    onSuccess: () => {
      toast({ title: 'Preferences saved' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.preferences() });
    },
  });
}
