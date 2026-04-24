import type {
  AdminGetIngestionScheduleResponses,
  AdminGetPollIntervalsResponses,
} from '@/lib/api';
import type { SyncSport } from './root-admin-sync-utils';

export type PollIntervalConfig = AdminGetPollIntervalsResponses[200];
export type IngestionScheduleConfig = AdminGetIngestionScheduleResponses[200];

export const INGESTION_POLICY_FIELDS = [
  {
    key: 'healthCheck',
    label: 'Health checks',
    intervalLabel: 'Minutes',
    intervalKey: 'intervalMinutes',
  },
  {
    key: 'eventSchedule',
    label: 'Event schedule',
    intervalLabel: 'Minutes',
    intervalKey: 'intervalMinutes',
    extraKey: 'lookaheadDays',
    extraLabel: 'Lookahead days',
  },
  {
    key: 'eventParticipants',
    label: 'Event participants',
    intervalLabel: 'Minutes',
    intervalKey: 'intervalMinutes',
    extraKey: 'leadDaysBeforeStart',
    extraLabel: 'Lead days',
  },
  {
    key: 'participantRankings',
    label: 'Participant rankings',
    intervalLabel: 'Minutes',
    intervalKey: 'intervalMinutes',
  },
  {
    key: 'eventLiveScores',
    label: 'Event live scores',
    intervalLabel: 'Seconds',
    intervalKey: 'intervalSeconds',
  },
  {
    key: 'eventResults',
    label: 'Event results',
    intervalLabel: 'Minutes',
    intervalKey: 'intervalMinutes',
  },
] as const;

export type IngestionPolicyField = (typeof INGESTION_POLICY_FIELDS)[number];
export type IngestionPolicyKey = IngestionPolicyField['key'];

export function extractAdminErrorMessage(
  error: unknown,
  fallback = 'We could not load this admin data right now.',
) {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const candidate = error as {
    error?: { message?: unknown };
    message?: unknown;
  };

  if (typeof candidate.error?.message === 'string') {
    return candidate.error.message;
  }

  if (typeof candidate.message === 'string') {
    return candidate.message;
  }

  return fallback;
}

export function clonePollConfig(config: PollIntervalConfig): PollIntervalConfig {
  return { ...config };
}

export function cloneIngestionConfig(
  config: IngestionScheduleConfig,
): IngestionScheduleConfig {
  return {
    ...config,
    healthCheck: { ...config.healthCheck },
    eventSchedule: { ...config.eventSchedule },
    eventParticipants: { ...config.eventParticipants },
    participantRankings: { ...config.participantRankings },
    eventLiveScores: { ...config.eventLiveScores },
    eventResults: { ...config.eventResults },
    perSportOverrides: Object.fromEntries(
      Object.entries(config.perSportOverrides ?? {}).map(([sport, override]) => [
        sport,
        {
          ...(override.healthCheck && { healthCheck: { ...override.healthCheck } }),
          ...(override.eventSchedule && { eventSchedule: { ...override.eventSchedule } }),
          ...(override.eventParticipants && {
            eventParticipants: { ...override.eventParticipants },
          }),
          ...(override.participantRankings && {
            participantRankings: { ...override.participantRankings },
          }),
          ...(override.eventLiveScores && {
            eventLiveScores: { ...override.eventLiveScores },
          }),
          ...(override.eventResults && { eventResults: { ...override.eventResults } }),
        },
      ]),
    ),
  };
}

export function buildSportOverrideDraft(
  config: IngestionScheduleConfig,
  sport: SyncSport,
): Record<IngestionPolicyKey, boolean> {
  const override = config.perSportOverrides[sport];

  return Object.fromEntries(
    INGESTION_POLICY_FIELDS.map((field) => [
      field.key,
      override?.[field.key]?.enabled ?? config[field.key].enabled,
    ]),
  ) as Record<IngestionPolicyKey, boolean>;
}

export function toPositiveNumber(value: string) {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}
