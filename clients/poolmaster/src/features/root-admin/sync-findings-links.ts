import { ProviderSyncFindingStatus, type ProviderSyncFindingSeverity } from '@poolmaster/shared/domain';
import { encodeGridState } from '@/features/shared/ui';
import { SYNC_FINDINGS_PATH } from './manage-navigation';
import { SYNC_FINDING_LEAGUE_COLUMN } from './sync-finding-columns';

/** The Findings grid's link parameter, which the Sports page's Findings links fill with a sport league. */
export const SYNC_FINDINGS_GRID_KEY = 'findings';

/**
 * Findings filtered to one sport league's OPEN findings of one severity (#1999): where the Sports
 * page's Findings chip sends each of its counts. The grid's own column filters, in its link.
 */
export function buildLeagueOpenFindingsPath(sportLeagueId: string, severity: ProviderSyncFindingSeverity): string {
  const state = encodeGridState({
    sorting: [],
    filters: [
      { id: 'severity', value: { kind: 'enum', values: [severity], match: 'any' } },
      { id: SYNC_FINDING_LEAGUE_COLUMN, value: { kind: 'enum', values: [sportLeagueId], match: 'any' } },
      { id: 'status', value: { kind: 'enum', values: [ProviderSyncFindingStatus.OPEN], match: 'any' } },
    ],
  });
  return state === null ? SYNC_FINDINGS_PATH : `${SYNC_FINDINGS_PATH}?${new URLSearchParams({ [SYNC_FINDINGS_GRID_KEY]: state }).toString()}`;
}
