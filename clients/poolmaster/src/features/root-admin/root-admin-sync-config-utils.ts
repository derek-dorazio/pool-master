import type { IngestionScheduleConfig } from '@/lib/api';
import type { SyncSport } from './root-admin-sync-utils';

// Re-exported so the root-admin config pages keep importing these from one place;
// the shapes themselves are the generated named components (see plans/143).
export type { IngestionScheduleConfig };

export const INGESTION_POLICY_FIELDS = [
  {
    key: 'healthCheck',
    label: 'Health checks',
    intervalLabel: 'Minutes',
    intervalKey: 'intervalMinutes',
  },
  {
    key: 'eventParticipants',
    label: 'Event participants',
    intervalLabel: 'Minutes',
    intervalKey: 'intervalMinutes',
    extraKey: 'lookaheadDays',
    extraLabel: 'Field lookahead days',
  },
  {
    key: 'eventLiveScores',
    label: 'Event live scores',
    intervalLabel: 'Seconds',
    intervalKey: 'intervalSeconds',
  },
] as const;

export type IngestionPolicyField = (typeof INGESTION_POLICY_FIELDS)[number];
export type IngestionPolicyKey = IngestionPolicyField['key'];

export function cloneIngestionConfig(
  config: IngestionScheduleConfig,
): IngestionScheduleConfig {
  return {
    ...config,
    healthCheck: { ...config.healthCheck },
    eventParticipants: { ...config.eventParticipants },
    eventLiveScores: { ...config.eventLiveScores },
    perSportOverrides: Object.fromEntries(
      Object.entries(config.perSportOverrides ?? {}).map(([sport, override]) => [
        sport,
        {
          ...(override.healthCheck && { healthCheck: { ...override.healthCheck } }),
          ...(override.eventParticipants && {
            eventParticipants: { ...override.eventParticipants },
          }),
          ...(override.eventLiveScores && {
            eventLiveScores: { ...override.eventLiveScores },
          }),
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
