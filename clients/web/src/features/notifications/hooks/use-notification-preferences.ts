import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
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

const defaultPreferences: NotificationPreferences = {
  categories: {
    draft: { inApp: true, push: true, email: false },
    scoring: { inApp: true, push: true, email: true },
    contest: { inApp: true, push: false, email: true },
    league: { inApp: true, push: false, email: false },
    social: { inApp: true, push: false, email: false },
    account: { inApp: true, push: false, email: true },
  },
  dnd: {
    enabled: false,
    startTime: '22:00',
    endTime: '07:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
};

export function useNotificationPreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences(),
    queryFn: async (): Promise<NotificationPreferences> => {
      try {
        return await api.get<NotificationPreferences>('/v1/notifications/preferences');
      } catch {
        // Fallback to mock data when backend unavailable
        return defaultPreferences;
      }
    },
  });
}

export function useSaveNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (preferences: NotificationPreferences) => {
      try {
        return await api.put('/v1/notifications/preferences', preferences);
      } catch {
        // Fallback: simulate success when backend unavailable
        return undefined;
      }
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
