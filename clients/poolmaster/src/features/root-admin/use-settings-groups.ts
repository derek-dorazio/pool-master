import { useQuery } from '@tanstack/react-query';
import { listSettingsGroups } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * Every settings group (#450), for the Settings page and for any root-admin screen that reads
 * one, such as the price dialog reading the Budget pricing profiles. One cache entry, so a save
 * on the Settings page reaches every reader.
 */
export function useSettingsGroupsQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.settings,
    queryFn: async () => {
      const response = await listSettingsGroups();
      if (!response.data) {
        throwApiError(response.error, 'Settings response is missing data.');
      }
      return response.data.groups;
    },
    retry: false,
  });
}
