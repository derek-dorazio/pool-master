import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client, typedData } from '@/lib/api-client-generated';
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
      const result = await client.GET('/api/v1/account/consent');
      return typedData<ConsentPreferences>(result);
    },
  });
}

export function useUpdateConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (consent: Partial<ConsentPreferences>) => {
      const result: any = await client.POST('/api/v1/account/consent', {
        body: consent as never,
      });
      if (result.error) throw result.error;
      if (!result.response.ok) throw new Error(`Request failed: ${result.response.status}`);
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
