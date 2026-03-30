import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api-client';

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

const MOCK_FLAGS: FeatureFlag[] = [
  { key: 'live_draft_v2', name: 'Live Draft V2', type: 'Percentage', enabled: true, rolloutPct: 45, overridesCount: 2, owner: 'eng-team', lastUpdated: '2026-03-24' },
  { key: 'budget_pick_golf', name: 'Budget Pick - Golf', type: 'Boolean', enabled: true, rolloutPct: 100, overridesCount: 1, owner: 'product', lastUpdated: '2026-03-20' },
  { key: 'salary_cap_nfl', name: 'Salary Cap NFL', type: 'Tenant List', enabled: false, rolloutPct: 0, overridesCount: 3, owner: 'eng-team', lastUpdated: '2026-03-18' },
  { key: 'dark_mode', name: 'Dark Mode', type: 'Boolean', enabled: true, rolloutPct: 100, overridesCount: 0, owner: 'design', lastUpdated: '2026-03-15' },
  { key: 'new_scoring_ui', name: 'New Scoring UI', type: 'Percentage', enabled: true, rolloutPct: 20, overridesCount: 1, owner: 'eng-team', lastUpdated: '2026-03-22' },
  { key: 'bracket_ncaa', name: 'NCAA Bracket Mode', type: 'Boolean', enabled: true, rolloutPct: 100, overridesCount: 2, owner: 'product', lastUpdated: '2026-03-25' },
];

function buildFlagDetail(flag: FeatureFlag): FlagDetail {
  return {
    ...flag,
    description: `Feature flag controlling ${flag.name.toLowerCase()} functionality across the platform.`,
    created: '2026-01-15',
    overrides: [
      { tenantName: 'Ultimate Pool Manager Pro', override: true, reason: 'Beta tester', setBy: 'admin@poolmaster.io', setAt: '2026-03-20' },
      { tenantName: 'FanDraft', override: false, reason: 'Not ready for this tenant', setBy: 'admin@poolmaster.io', setAt: '2026-03-18' },
      { tenantName: 'RaceFan', override: true, reason: 'Early access partner', setBy: 'ops@poolmaster.io', setAt: '2026-03-22' },
    ],
  };
}

export function useFlagList() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'flags'],
    queryFn: async () => {
      try {
        return await adminApi.get<FeatureFlag[]>('/v1/admin/flags');
      } catch {
        return MOCK_FLAGS;
      }
    },
  });

  return { data: data ?? MOCK_FLAGS, isLoading };
}

export function useFlagDetail(key: string) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'flag', key],
    queryFn: async () => {
      try {
        return await adminApi.get<FlagDetail>(`/v1/admin/flags/${key}`);
      } catch {
        const flag = MOCK_FLAGS.find((f) => f.key === key) ?? MOCK_FLAGS[0];
        return buildFlagDetail(flag);
      }
    },
  });

  const fallback = buildFlagDetail(MOCK_FLAGS[0]);
  return { data: data ?? fallback, isLoading };
}
