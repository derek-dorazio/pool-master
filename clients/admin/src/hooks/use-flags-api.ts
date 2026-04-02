import { useQuery } from '@tanstack/react-query';
import { client, adminListFlags, adminGetFlagDetail } from '@/lib/api';

export type FlagType = 'Boolean' | 'Percentage' | 'Tenant List';

export interface FeatureFlag {
  key: string;
  name: string;
  type: FlagType;
  enabled: boolean;
  rolloutPct: number;
  overridesCount: number;
  owner: string;
  lastUpdated: string;
}

export interface TenantOverride {
  tenantName: string;
  override: boolean;
  reason: string;
  setBy: string;
  setAt: string;
}

export interface FlagDetail extends FeatureFlag {
  description: string;
  created: string;
  overrides: TenantOverride[];
}

export function useFlagList() {
  return useQuery({
    queryKey: ['admin', 'flags'],
    queryFn: async () => {
      const { data } = await adminListFlags({ client });
      return data;
    },
  });
}

export function useFlagDetail(key: string) {
  return useQuery({
    queryKey: ['admin', 'flag', key],
    queryFn: async () => {
      const { data } = await adminGetFlagDetail({ client, path: { flagKey: key } });
      return data;
    },
  });
}
