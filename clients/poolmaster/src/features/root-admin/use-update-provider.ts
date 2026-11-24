import {
  updateProviderLeague,
  updateProviderSettings,
  type UpdateProviderLeagueData,
  type UpdateProviderSettingsData,
} from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';

const logger = getLogger().child({ feature: 'root-admin-providers' });

/** A provider's or a provider league's save makes the provider list stale: it holds both. */
const PROVIDER_WRITE_INVALIDATES = [QueryKeys.rootAdmin.providers] as const;

/** Saves a provider's settings (#1997); a refusal is logged and shown in the dialog. */
export function useUpdateProviderSettings({ providerId, onSuccess }: { providerId: string; onSuccess?: () => void }) {
  return useInvalidatingMutation({
    mutationFn: async (body: UpdateProviderSettingsData['body']) => {
      const response = await updateProviderSettings({ path: { providerId }, body });
      if (!response.data?.provider) {
        throwApiError(response.error, 'Provider settings response is missing data.');
      }
      return response.data.provider;
    },
    invalidates: PROVIDER_WRITE_INVALIDATES,
    onSuccess,
    onError: (error) => {
      logger.warn({ action: 'provider.settings.failed', data: { providerId }, err: error }, 'Provider settings were refused');
    },
  });
}

/** Saves one of a provider's leagues (#1997); a refusal is logged and shown in the dialog. */
export function useUpdateProviderLeague({ providerId, providerLeagueId, onSuccess }: { providerId: string; providerLeagueId: string; onSuccess?: () => void }) {
  return useInvalidatingMutation({
    mutationFn: async (body: UpdateProviderLeagueData['body']) => {
      const response = await updateProviderLeague({ path: { providerId, providerLeagueId }, body });
      if (!response.data?.league) {
        throwApiError(response.error, 'Provider league response is missing data.');
      }
      return response.data.league;
    },
    invalidates: PROVIDER_WRITE_INVALIDATES,
    onSuccess,
    onError: (error) => {
      logger.warn({ action: 'provider.league.failed', data: { providerId, providerLeagueId }, err: error }, 'Provider league settings were refused');
    },
  });
}
