import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client, typedData } from '@/lib/api-client-generated';
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
      const result = await client.GET('/api/v1/notifications/preferences');
      return typedData<NotificationPreferences>(result);
    },
  });
}

export function useSaveNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (preferences: NotificationPreferences) => {
      const result: any = await client.PUT('/api/v1/notifications/preferences', {
        body: preferences as never,
      });
      if (result.error) throw result.error;
      if (!result.response.ok) throw new Error(`Request failed: ${result.response.status}`);
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
