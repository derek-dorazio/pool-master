import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client, getConsentHistory, recordConsent } from '@/lib/api';
import type { RecordConsentData } from '@poolmaster/shared/generated/hey-api';
import { settingsKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';
import {
  ConsentHistoryResponseSchema,
  ConsentPreferencesDtoSchema,
} from '@poolmaster/shared/dto';

const CONSENT_VERSION = '1.0';

const consentTypeByPreference: Record<keyof ConsentPreferences, RecordConsentData['body']['consentType']> = {
  marketingEmails: 'marketing_email',
  analytics: 'analytics_cookies',
  thirdPartyIntegrations: 'third_party_integrations',
  doNotSell: 'do_not_sell',
};

export interface ConsentPreferences {
  marketingEmails: boolean;
  analytics: boolean;
  thirdPartyIntegrations: boolean;
  doNotSell: boolean;
}

function deriveConsentPreferences(consents: Array<{ consentType: string; granted: boolean }>): ConsentPreferences {
  const latestByType = new Map<string, boolean>();
  for (const consent of consents) {
    if (!latestByType.has(consent.consentType)) {
      latestByType.set(consent.consentType, consent.granted);
    }
  }

  return ConsentPreferencesDtoSchema.parse({
    marketingEmails: latestByType.get('marketing_email') ?? false,
    analytics: latestByType.get('analytics_cookies') ?? false,
    thirdPartyIntegrations: latestByType.get('third_party_integrations') ?? false,
    doNotSell: latestByType.get('do_not_sell') ?? false,
  });
}

export function useConsent() {
  return useQuery({
    queryKey: settingsKeys.consent(),
    queryFn: async (): Promise<ConsentPreferences> => {
      const { data, error } = await getConsentHistory({ client });
      if (error) throw error;
      const parsed = ConsentHistoryResponseSchema.parse(data);
      return deriveConsentPreferences(parsed.consents as Array<{ consentType: string; granted: boolean }>);
    },
  });
}

export function useUpdateConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (consent: Partial<ConsentPreferences>) => {
      const updates = Object.entries(consent) as Array<[keyof ConsentPreferences, boolean]>;
      for (const [key, granted] of updates) {
        const { error } = await recordConsent({
          client,
          body: {
            consentType: consentTypeByPreference[key],
            granted,
            version: CONSENT_VERSION,
          },
        });
        if (error) throw error;
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
