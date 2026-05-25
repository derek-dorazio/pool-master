import type {
  AdminListProviderSyncRunsResponses,
  AdminListProvidersResponses,
  AdminPrepareSportSyncResponses,
  AdminRunContestQaWorkflowResponses,
  AdminSyncProviderEventDataResponses,
} from '@/lib/api';

export type ProviderSyncRun = AdminListProviderSyncRunsResponses[200]['items'][number];
export type ProviderSummary = AdminListProvidersResponses[200]['items'][number];
export type SportSyncSubmission = AdminPrepareSportSyncResponses[202];
export type EventSyncSubmission = AdminSyncProviderEventDataResponses[202];
export type ContestQaWorkflowSubmission = AdminRunContestQaWorkflowResponses[202];

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

export const FEED_LABELS = {
  EVENTSCHEDULE: 'Schedule',
  EVENTPARTICIPANTS: 'Participants',
  PARTICIPANTRANKINGS: 'Rankings / odds',
  EVENTLIVESCORES: 'Live scores',
  EVENTRESULTS: 'Final results',
} as const;

export function getProviderName(
  providerId: string,
  providers: ProviderSummary[] | undefined,
) {
  return providers?.find((provider) => provider.providerId === providerId)?.providerName ?? providerId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getPayloadOutcome(payload: Record<string, unknown>) {
  const outcome = payload.outcome;
  if (!isRecord(outcome)) {
    return null;
  }

  const severity = outcome.severity;
  const summary = outcome.summary;
  const warnings = outcome.warnings;

  return {
    severity: severity === 'SUCCESS' || severity === 'WARNING' || severity === 'ERROR'
      ? severity
      : null,
    summary: typeof summary === 'string' ? summary : null,
    warnings: Array.isArray(warnings) ? warnings : [],
  };
}

export function getRequestedFeed(payload: Record<string, unknown>) {
  const requestedFeed = payload.requestedFeed;
  return typeof requestedFeed === 'string' && requestedFeed in FEED_LABELS
    ? requestedFeed as keyof typeof FEED_LABELS
    : null;
}

export function formatRequestedFeed(payload: Record<string, unknown>) {
  const requestedFeed = getRequestedFeed(payload);
  return requestedFeed ? FEED_LABELS[requestedFeed] : 'Unknown feed';
}

export function getPayloadWarnings(payload: Record<string, unknown>) {
  return getPayloadOutcome(payload)?.warnings.flatMap((warning) => {
    if (!isRecord(warning)) {
      return [];
    }

    const code = warning.code;
    const message = warning.message;
    return [{
      code: typeof code === 'string' ? code : 'SYNC_WARNING',
      message: typeof message === 'string' ? message : 'Sync completed with a warning.',
    }];
  }) ?? [];
}

export function buildPayloadSummary(payload: Record<string, unknown>) {
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

export function buildCompactStatsSummary(payload: Record<string, unknown>) {
  const stats = buildStatsSummary(payload);
  if (stats.length === 0) {
    return 'No stats';
  }

  return stats
    .slice(0, 3)
    .map((stat) => `${stat.label}: ${stat.value}`)
    .join(' · ');
}

export function buildStatsSummary(payload: Record<string, unknown>) {
  const stats = payload.stats;
  if (!isRecord(stats)) {
    return [];
  }

  return Object.entries(stats).flatMap(([key, value]) => {
    if (typeof value !== 'number') {
      return [];
    }

    return [{
      key,
      label: key
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, (char) => char.toUpperCase()),
      value,
    }];
  });
}

export function getPayloadSection(
  payload: Record<string, unknown>,
  key: 'requestPayload' | 'providerPayload' | 'jobPayload',
) {
  const section = payload[key];
  return isRecord(section) ? section : null;
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
