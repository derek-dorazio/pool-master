import { updateSettingsGroup, type BillingConfig, type SettingsGroup } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';

export type BillingSettingsGroup = Extract<SettingsGroup, { key: 'BILLING_CONFIG' }>;

/**
 * Saves the whole payments settings (BILLING_CONFIG) against the version the dialog was opened
 * on, so a save over someone else's newer one is refused (409) rather than lost. Every reader of
 * the settings refetches on success.
 */
export function useSaveBillingConfig({ onSaved }: { onSaved: (group: BillingSettingsGroup) => void }) {
  return useInvalidatingMutation({
    mutationFn: async ({ value, expectedUpdatedAt }: { value: BillingConfig; expectedUpdatedAt: string | null }) => {
      const response = await updateSettingsGroup({
        path: { key: 'BILLING_CONFIG' },
        body: { key: 'BILLING_CONFIG', value, expectedUpdatedAt },
      });
      if (!response.data || response.data.key !== 'BILLING_CONFIG') {
        throwApiError(response.error, 'Payments settings response is missing data.');
      }
      return response.data;
    },
    onSuccess: onSaved,
    invalidates: [QueryKeys.rootAdmin.settings],
  });
}
