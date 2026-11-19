import type { IngestionScheduleConfig } from '@/lib/api';

// Re-exported so the root-admin config pages keep importing these from one place;
// the shapes themselves are the generated named components (`rules/service-rules.md` §4).
export type { IngestionScheduleConfig };

export const INGESTION_POLICY_FIELDS = [
  {
    key: 'healthCheck',
    label: 'Health checks',
    intervalLabel: 'Minutes',
    intervalKey: 'intervalMinutes',
  },
  {
    key: 'eventList',
    label: 'Event list',
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
    eventList: { ...config.eventList },
    eventLiveScores: { ...config.eventLiveScores },
  };
}

export function toPositiveNumber(value: string) {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}
