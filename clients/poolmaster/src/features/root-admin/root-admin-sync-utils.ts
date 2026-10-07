import type { ProviderManualSyncSubmissionResponse, ProviderSummaryDto, ProviderSyncRunDto } from '@/lib/api';

// #205 — the canonical named components, not indexes into the response map.
export type ProviderSyncRun = ProviderSyncRunDto;
export type ProviderSummary = ProviderSummaryDto;
export type EventSyncSubmission = ProviderManualSyncSubmissionResponse;

export const ALL_SYNC_SPORT_OPTIONS = [
  'GOLF',
  'NFL',
  'NBA',
  'F1',
  'NASCAR',
  'NCAA_BASKETBALL',
  'NCAA_HOCKEY',
  'NCAA_FOOTBALL',
  'TENNIS',
  'HORSE_RACING',
  'SOCCER',
  'NHL',
  'MLB',
  'UFC',
] as const;
export type SyncSport = (typeof ALL_SYNC_SPORT_OPTIONS)[number];

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

export function getProviderName(
  providerId: string,
  providers: ProviderSummary[] | undefined,
) {
  return providers?.find((provider) => provider.providerId === providerId)?.providerName ?? providerId;
}

export type ProviderSyncRunPayload = ProviderSyncRun['payload'];

export function getPayloadOutcome(payload: ProviderSyncRunPayload) {
  return payload.outcome ?? null;
}

export function getRequestedFeed(payload: ProviderSyncRunPayload) {
  return payload.requestedFeed ?? null;
}

export function formatRequestedFeed(payload: ProviderSyncRunPayload) {
  const requestedFeed = getRequestedFeed(payload);
  return requestedFeed ? FEED_LABELS[requestedFeed] : 'Unknown feed';
}

export function getPayloadWarnings(payload: ProviderSyncRunPayload) {
  return getPayloadOutcome(payload)?.warnings ?? [];
}

export function buildPayloadSummary(payload: ProviderSyncRunPayload) {
  const outcome = getPayloadOutcome(payload);
  if (outcome?.summary) {
    return outcome.summary;
  }

  const primaryTextFields = ['detail', 'message', 'summary', 'runType'] as const;
  for (const key of primaryTextFields) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  const metricPairs: Array<[string, string]> = [
    ['recordsProcessed', 'processed'],
    ['eventCount', 'events'],
    ['participantCount', 'participants'],
    ['errorCount', 'errors'],
    ['errors', 'errors'],
  ];

  const metrics = metricPairs.flatMap(([key, label]) => {
    const value = payload[key];
    if (typeof value === 'number') {
      return [`${value} ${label}`];
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return [`${label}: ${value}`];
    }

    return [];
  });

  if (metrics.length > 0) {
    return metrics.slice(0, 3).join(' · ');
  }

  const fallbackEntries = Object.entries(payload).flatMap(([key, value]) => {
    if (
      value === null
      || value === undefined
      || typeof value === 'object'
      || key.endsWith('At')
      || key === 'providerId'
      || key === 'eventId'
      || key === 'status'
    ) {
      return [];
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return [`${key}: ${String(value)}`];
    }

    return [];
  });

  return fallbackEntries[0] ?? 'Payload captured for operational review.';
}

export function buildCompactStatsSummary(payload: ProviderSyncRunPayload) {
  const stats = buildStatsSummary(payload);
  if (stats.length === 0) {
    return 'No stats';
  }

  return stats
    .slice(0, 3)
    .map((stat) => `${stat.label}: ${stat.value}`)
    .join(' · ');
}

export function buildStatsSummary(payload: ProviderSyncRunPayload) {
  return Object.entries(payload.stats ?? {}).map(([key, value]) => ({
    key,
    label: key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, (char) => char.toUpperCase()),
    value,
  }));
}

export function getPayloadSection<K extends 'requestPayload' | 'providerPayload' | 'jobPayload'>(
  payload: ProviderSyncRunPayload,
  key: K,
): NonNullable<ProviderSyncRunPayload[K]> | null {
  return payload[key] ?? null;
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
