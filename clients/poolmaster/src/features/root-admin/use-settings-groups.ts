import { useQuery } from '@tanstack/react-query';
import { getSettingsGroup, listSettingsGroups, type SettingsGroup } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * Every settings group (#450), for the Settings page. One cache entry, so a save on the Settings
 * page reaches every reader.
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

/**
 * One settings group, for a screen that needs only it (the Plans page, the price dialog's Budget
 * pricing profiles), so it does not load every group (#1241). Keyed under the groups list, so a
 * save that invalidates `settings` refreshes it too.
 */
export function useSettingsGroupQuery<K extends SettingsGroup['key']>(key: K) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.settingsGroup(key),
    queryFn: async (): Promise<Extract<SettingsGroup, { key: K }>> => {
      const response = await getSettingsGroup({ path: { key } });
      if (!response.data || !isGroup(response.data, key)) {
        throwApiError(response.error, 'Settings group response is missing data.');
      }
      return response.data;
    },
    retry: false,
  });
}

function isGroup<K extends SettingsGroup['key']>(group: SettingsGroup, key: K): group is Extract<SettingsGroup, { key: K }> {
  return group.key === key;
}
