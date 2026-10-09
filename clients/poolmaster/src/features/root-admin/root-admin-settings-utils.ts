import type { EmailConfig, IngestionScheduleConfig, SettingsChange } from '@/lib/api';

export type SettingsSummaryItem = {
  id: string;
  label: string;
  value: string;
};

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

export const EMAIL_TEMPLATE_LABELS: ReadonlyArray<readonly [keyof EmailConfig['templates'], string]> = [
  ['LEAGUE_MEMBER_INVITE', 'League invitation'],
  ['LEAGUE_JOIN_SUCCESS', 'League welcome'],
  ['CONTEST_ENTRY_COMPLETED', 'Entry confirmation'],
  ['CONTEST_STARTED_SUMMARY', 'Contest started'],
];

export function summarizeEmail(config: EmailConfig): SettingsSummaryItem[] {
  const off = EMAIL_TEMPLATE_LABELS.filter(([key]) => !config.templates[key]).map(([, label]) => label);
  return [
    { id: 'enabled', label: 'System email', value: config.enabled ? 'On' : 'Off' },
    { id: 'templates', label: 'Emails switched off', value: off.length > 0 ? off.join(', ') : 'None' },
    { id: 'replyTo', label: 'Reply-To', value: config.replyTo ?? 'The sender address' },
  ];
}

/** The top-level fields a change touched, in the order the new value lists them. */
export function changedFields(change: SettingsChange): string[] {
  // Each group's value is its own object type; the comparison only needs its top-level entries.
  const previous = new Map(Object.entries(change.previousValue ?? {}));
  const next = new Map(Object.entries(change.newValue));
  const keys = [...new Set([...next.keys(), ...previous.keys()])];
  return keys.filter((key) => JSON.stringify(previous.get(key)) !== JSON.stringify(next.get(key)));
}
