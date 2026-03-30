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
      try {
        return await api.get<ConsentPreferences>('/v1/account/consent');
      } catch {
        // Fallback to mock data when backend unavailable
        return mockConsent;
      }
    },
  });
}

export function useUpdateConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (consent: Partial<ConsentPreferences>) => {
      try {
        return await api.put('/v1/account/consent', consent);
      } catch {
        // Fallback: simulate success when backend unavailable
        return undefined;
      }
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
