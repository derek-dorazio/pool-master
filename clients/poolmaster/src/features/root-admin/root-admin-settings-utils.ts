import type { IngestionScheduleConfig, PollIntervalConfig, SettingsChange } from '@/lib/api';

export type SettingsSummaryItem = {
  id: string;
  label: string;
  value: string;
};

const POLL_INTERVAL_LABELS: ReadonlyArray<readonly [keyof PollIntervalConfig, string]> = [
  ['standings', 'Standings'],
  ['draft', 'Draft'],
  ['contestStatus', 'Contest status'],
  ['notifications', 'Notifications'],
  ['default', 'Everything else'],
];

function seconds(ms: number): string {
  return `Every ${ms / 1000} s`;
}

export function summarizePollIntervals(config: PollIntervalConfig): SettingsSummaryItem[] {
  return POLL_INTERVAL_LABELS.map(([key, label]) => ({ id: key, label, value: seconds(config[key]) }));
}

function feedSummary(policy: { enabled: boolean; intervalMinutes?: number; intervalSeconds?: number }): string {
  if (!policy.enabled) {
    return 'Off';
  }
  if (policy.intervalSeconds !== undefined) {
    return `Every ${policy.intervalSeconds} s`;
  }
  if (policy.intervalMinutes !== undefined) {
    return `Every ${policy.intervalMinutes} min`;
  }
  return 'On';
}

export function summarizeIngestionSchedule(config: IngestionScheduleConfig): SettingsSummaryItem[] {
  const overrideSports = Object.keys(config.perSportOverrides);
  return [
    { id: 'scheduledSports', label: 'Scheduled sports', value: config.scheduledSports?.join(', ') ?? 'None' },
    { id: 'eventLiveScores', label: 'Live scores', value: feedSummary(config.eventLiveScores) },
    { id: 'eventParticipants', label: 'Field sync', value: feedSummary(config.eventParticipants) },
    { id: 'healthCheck', label: 'Provider health check', value: feedSummary(config.healthCheck) },
    {
      id: 'perSportOverrides',
      label: 'Sport overrides',
      value: overrideSports.length > 0 ? overrideSports.join(', ') : 'None',
    },
  ];
}

/** The top-level fields a change touched, in the order the new value lists them. */
export function changedFields(change: SettingsChange): string[] {
  const previous = change.previousValue ?? {};
  const keys = [...new Set([...Object.keys(change.newValue), ...Object.keys(previous)])];
  return keys.filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(change.newValue[key]));
}
