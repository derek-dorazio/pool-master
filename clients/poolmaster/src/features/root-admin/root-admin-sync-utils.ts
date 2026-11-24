import { Sport } from '@poolmaster/shared/domain';
import type {
  ProviderManualSyncSubmissionResponse,
  ProviderSummaryDto,
  ProviderSyncRunDetailDto,
  ProviderSyncRunDto,
} from '@/lib/api';

// #205 — the canonical named components, not indexes into the response map.
export type ProviderSyncRun = ProviderSyncRunDto;
export type ProviderSyncRunDetail = ProviderSyncRunDetailDto;
export type ProviderSummary = ProviderSummaryDto;
export type EventSyncSubmission = ProviderManualSyncSubmissionResponse;

export const ALL_SYNC_SPORT_OPTIONS: readonly Sport[] = Object.values(Sport);
export type SyncSport = Sport;

export const SYNC_STATUS_OPTIONS = [
  'SUBMITTED',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type SyncStatus = (typeof SYNC_STATUS_OPTIONS)[number];

export const EVENT_SYNC_PRESETS = [
  {
    id: 'EVENTPARTICIPANTS',
    label: 'Refresh event participants',
    feeds: ['EVENTPARTICIPANTS'] as const,
  },
  {
    id: 'EVENTLIVESCORES',
    label: 'Refresh live scores',
    feeds: ['EVENTLIVESCORES'] as const,
  },
] as const;
export type EventSyncPresetId = (typeof EVENT_SYNC_PRESETS)[number]['id'];

export const FEED_LABELS = {
  EVENTPARTICIPANTS: 'Participants',
  EVENTLIVESCORES: 'Live scores',
} as const;

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

export function getEventSyncPreset(presetId: EventSyncPresetId) {
  return EVENT_SYNC_PRESETS.find((preset) => preset.id === presetId) ?? EVENT_SYNC_PRESETS[0];
}

export function formatJsonPayload(payload: unknown) {
  return JSON.stringify(payload, null, 2);
}

export function getSupportedSyncSports(
  providers: ProviderSummary[] | undefined,
): SyncSport[] {
  const configuredSports = Array.from(
    new Set((providers ?? []).flatMap((provider) => provider.sportsCovered)),
  ).filter((sport): sport is SyncSport =>
    ALL_SYNC_SPORT_OPTIONS.includes(sport),
  );

  if (configuredSports.length === 0) {
    return [...ALL_SYNC_SPORT_OPTIONS];
  }

  return ALL_SYNC_SPORT_OPTIONS.filter((sport) => configuredSports.includes(sport));
}
