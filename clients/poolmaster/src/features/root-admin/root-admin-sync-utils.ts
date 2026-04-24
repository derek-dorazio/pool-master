import type {
  AdminListProviderSyncRunsResponses,
  AdminListProvidersResponses,
  AdminPrepareSportSyncResponses,
  AdminSyncProviderEventDataResponses,
} from '@/lib/api';

export type ProviderSyncRun = AdminListProviderSyncRunsResponses[200]['items'][number];
export type ProviderSummary = AdminListProvidersResponses[200]['items'][number];
export type SportSyncSubmission = AdminPrepareSportSyncResponses[202];
export type EventSyncSubmission = AdminSyncProviderEventDataResponses[202];

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

export const SPORT_SYNC_PRESETS = [
  {
    id: 'PREPARE_EVENT_DATA',
    label: 'Prepare event data',
    feeds: ['EVENTSCHEDULE', 'EVENTPARTICIPANTS', 'PARTICIPANTRANKINGS'] as const,
  },
  {
    id: 'EVENTPARTICIPANTS_ONLY',
    label: 'Refresh participants only',
    feeds: ['EVENTPARTICIPANTS'] as const,
  },
  {
    id: 'EVENTSCHEDULE_ONLY',
    label: 'Refresh schedule only',
    feeds: ['EVENTSCHEDULE'] as const,
  },
  {
    id: 'PARTICIPANTRANKINGS_ONLY',
    label: 'Refresh rankings only',
    feeds: ['PARTICIPANTRANKINGS'] as const,
  },
] as const;
export type SportSyncPresetId = (typeof SPORT_SYNC_PRESETS)[number]['id'];

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
  {
    id: 'EVENTRESULTS',
    label: 'Refresh final results',
    feeds: ['EVENTRESULTS'] as const,
  },
] as const;
export type EventSyncPresetId = (typeof EVENT_SYNC_PRESETS)[number]['id'];

export function getProviderName(
  providerId: string,
  providers: ProviderSummary[] | undefined,
) {
  return providers?.find((provider) => provider.providerId === providerId)?.providerName ?? providerId;
}

export function buildPayloadSummary(payload: Record<string, unknown>) {
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

export function getProviderStatusClasses(status: ProviderSummary['status']) {
  switch (status) {
    case 'HEALTHY':
      return 'border-emerald-300 bg-emerald-50 text-emerald-900';
    case 'DOWN':
      return 'border-rose-300 bg-rose-50 text-rose-900';
    case 'DEGRADED':
      return 'border-amber-300 bg-amber-50 text-amber-900';
  }
}

export function getSyncRunStatusClasses(status: ProviderSyncRun['status']) {
  switch (status) {
    case 'SUBMITTED':
      return 'border-sky-300 bg-sky-50 text-sky-900';
    case 'IN_PROGRESS':
      return 'border-indigo-300 bg-indigo-50 text-indigo-900';
    case 'FAILED':
      return 'border-rose-300 bg-rose-50 text-rose-900';
    case 'CANCELLED':
      return 'border-amber-300 bg-amber-50 text-amber-900';
    case 'COMPLETED':
      return 'border-slate-300 bg-slate-50 text-slate-900';
  }
}

export function getSportSyncPreset(presetId: SportSyncPresetId) {
  return SPORT_SYNC_PRESETS.find((preset) => preset.id === presetId) ?? SPORT_SYNC_PRESETS[0];
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
    ALL_SYNC_SPORT_OPTIONS.includes(sport as SyncSport),
  );

  if (configuredSports.length === 0) {
    return [...ALL_SYNC_SPORT_OPTIONS];
  }

  return ALL_SYNC_SPORT_OPTIONS.filter((sport) => configuredSports.includes(sport));
}
