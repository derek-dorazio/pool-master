import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { settingsKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';

export interface ConsentPreferences {
  marketingEmails: boolean;
  analytics: boolean;
  thirdPartyIntegrations: boolean;
  doNotSell: boolean;
}

const mockConsent: ConsentPreferences = {
  marketingEmails: false,
  analytics: true,
  thirdPartyIntegrations: false,
  doNotSell: false,
};

export function useConsent() {
  return useQuery({
    queryKey: settingsKeys.consent(),
    queryFn: async (): Promise<ConsentPreferences> => {
      // TODO: return api.get<ConsentPreferences>('/account/consent');
      await new Promise((resolve) => setTimeout(resolve, 200));
      return mockConsent;
    },
  });
}

export function useUpdateConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (consent: Partial<ConsentPreferences>) => {
      // TODO: return api.put('/account/consent', consent);
      await new Promise((resolve) => setTimeout(resolve, 200));
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
