import { useQuery } from '@tanstack/react-query';
import { listPlatformPricingProfiles, listPlatformTierProfiles, type PlatformPricingProfileDto, type PlatformTierProfileDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** The platform's tier profiles (#1844), by name: what a sport league can name. */
export function usePlatformTierProfilesQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.platformTierProfiles,
    queryFn: async (): Promise<PlatformTierProfileDto[]> => {
      const response = await listPlatformTierProfiles();
      if (!response.data) {
        throwApiError(response.error, 'Tier profiles response is missing data.');
      }
      return response.data.platformTierProfiles;
    },
    retry: false,
  });
}

/** The platform's pricing profiles (#1844), by name: what a sport league can name and the price dialog offers. */
export function usePlatformPricingProfilesQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.platformPricingProfiles,
    queryFn: async (): Promise<PlatformPricingProfileDto[]> => {
      const response = await listPlatformPricingProfiles();
      if (!response.data) {
        throwApiError(response.error, 'Pricing profiles response is missing data.');
      }
      return response.data.platformPricingProfiles;
    },
    retry: false,
  });
}
