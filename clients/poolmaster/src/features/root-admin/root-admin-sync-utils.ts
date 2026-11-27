import type { Sport } from '@poolmaster/shared/domain';
import type {
  ProviderManualSyncSubmissionResponse,
  ProviderSummaryDto,
  SportLeagueOverviewDto,
  ProviderSyncRunDetailDto,
  ProviderSyncRunDto,
} from '@/lib/api';

// #205 — the canonical named components, not indexes into the response map.
export type ProviderSyncRun = ProviderSyncRunDto;
export type ProviderSyncRunDetail = ProviderSyncRunDetailDto;
export type ProviderSummary = ProviderSummaryDto;
export type EventSyncSubmission = ProviderManualSyncSubmissionResponse;

/** A run's counts as labelled facts: `liveScoreUpdatesReturned` reads "Live Score Updates Returned". */
export function buildStatsSummary(run: Pick<ProviderSyncRun, 'stats'>) {
  return Object.entries(run.stats).map(([key, value]) => ({
    key,
    label: key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, (char) => char.toUpperCase()),
    value,
  }));
}

export type ProviderSyncRunDetails = NonNullable<ProviderSyncRunDetail['details']>;

export function getDetailsSection<K extends 'providerPayload' | 'jobPayload'>(
  details: ProviderSyncRunDetails | null | undefined,
  key: K,
): NonNullable<ProviderSyncRunDetails[K]> | null {
  return details?.[key] ?? null;
}

export function formatJsonPayload(payload: unknown) {
  return JSON.stringify(payload, null, 2);
}

/**
 * The sports a provider syncs an active sport league of (#2073): each league's own sync, never a
 * provider's sports. In the sports' display order.
 */
export function syncedSports(
  leagues: readonly Pick<SportLeagueOverviewDto, 'sport' | 'sportDisplayOrder' | 'providerId' | 'isActive'>[] | undefined,
): Sport[] {
  const synced = (leagues ?? [])
    .filter((league) => league.isActive && league.providerId !== null)
    .sort((a, b) => a.sportDisplayOrder - b.sportDisplayOrder);
  return [...new Set(synced.map((league) => league.sport))];
}
