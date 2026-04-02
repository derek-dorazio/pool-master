import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { clientPath, API_ROUTES } from '@poolmaster/shared/api-routes';
import { settingsKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';

export interface ConsentPreferences {
  marketingEmails: boolean;
  analytics: boolean;
  thirdPartyIntegrations: boolean;
  doNotSell: boolean;
}

export function useConsent() {
  return useQuery({
    queryKey: settingsKeys.consent(),
    queryFn: async (): Promise<ConsentPreferences> => {
      return await api.get<ConsentPreferences>(clientPath(API_ROUTES.account.consent));
    },
  });
}

export function useUpdateConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (consent: Partial<ConsentPreferences>) => {
      return await api.put(clientPath(API_ROUTES.account.consent), consent);
    },
    onMutate: async (newConsent) => {
      await queryClient.cancelQueries({ queryKey: settingsKeys.consent() });
      const previous = queryClient.getQueryData<ConsentPreferences>(settingsKeys.consent());
      if (previous) {
        queryClient.setQueryData(settingsKeys.consent(), { ...previous, ...newConsent });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(settingsKeys.consent(), context.previous);
      }
      toast({ title: 'Failed to update preference', description: 'Please try again.' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.consent() });
    },
  });
}
