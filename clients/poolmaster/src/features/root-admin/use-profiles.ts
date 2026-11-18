import { useQuery } from '@tanstack/react-query';
import { listPricingProfiles, listTierProfiles, type PricingProfileDto, type TierProfileDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** The platform's tier profiles (#1844), by name: what a sport league can name. */
export function useTierProfilesQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.tierProfiles,
    queryFn: async (): Promise<TierProfileDto[]> => {
      const response = await listTierProfiles();
      if (!response.data) {
        throwApiError(response.error, 'Tier profiles response is missing data.');
      }
      return response.data.tierProfiles;
    },
    retry: false,
  });
}

/** The platform's pricing profiles (#1844), by name: what a sport league can name and the price dialog offers. */
export function usePricingProfilesQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.pricingProfiles,
    queryFn: async (): Promise<PricingProfileDto[]> => {
      const response = await listPricingProfiles();
      if (!response.data) {
        throwApiError(response.error, 'Pricing profiles response is missing data.');
      }
      return response.data.pricingProfiles;
    },
    retry: false,
  });
}
