import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { clientPath, API_ROUTES } from '@poolmaster/shared/api-routes';
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
      return await api.get<NotificationPreferences>(
        clientPath(API_ROUTES.notifications.preferences),
      );
    },
  });
}

export function useSaveNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (preferences: NotificationPreferences) => {
      return await api.put(clientPath(API_ROUTES.notifications.preferences), preferences);
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
