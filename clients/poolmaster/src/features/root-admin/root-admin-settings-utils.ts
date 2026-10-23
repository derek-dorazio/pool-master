import type { BudgetPricingConfig, EmailConfig, IngestionScheduleConfig, SettingsChange } from '@/lib/api';
import { describeBudgetPricing } from './budget-pricing-format';

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
  ['CONTEST_ENTRY_REMINDER', 'Entry reminders'],
  ['CONTEST_OPENED', 'New contest open'],
  ['CONTEST_STANDINGS', 'Live standings'],
  ['CONTEST_RESULTS', 'Final results'],
  ['CONTEST_EVENT_CHANGED', 'Event postponed or cancelled'],
  ['EVENT_COMING_UP', 'Event coming up (commissioners)'],
  ['EVENT_READY_FOR_CONTESTS', 'Event ready for contests (commissioners)'],
  ['CONTEST_NOT_OPEN', 'Contest not open yet (commissioners)'],
];

/** The entry reminder offsets as a reader sees them, e.g. "48, 24, 3 hours before picks close". */
function formatReminderHours(hours: readonly number[]): string {
  return `${hours.join(', ')} hours before picks close`;
}

export function summarizeEmail(config: EmailConfig): SettingsSummaryItem[] {
  const off = EMAIL_TEMPLATE_LABELS.filter(([key]) => !config.templates[key]).map(([, label]) => label);
  return [
    { id: 'enabled', label: 'System email', value: config.enabled ? 'On' : 'Off' },
    { id: 'templates', label: 'Emails switched off', value: off.length > 0 ? off.join(', ') : 'None' },
    {
      id: 'allowedRecipients',
      label: 'Only send to',
      value: config.allowedRecipients.length > 0 ? config.allowedRecipients.join(', ') : 'Everyone',
    },
    { id: 'sendRatePerSecond', label: 'Emails a second', value: String(config.sendRatePerSecond) },
    { id: 'entryReminderHours', label: 'Entry reminders', value: formatReminderHours(config.entryReminderHours) },
    { id: 'standingsBufferMinutes', label: 'Standings email delay', value: `${String(config.standingsBufferMinutes)} minutes` },
  ];
}

/** One row per pricing profile, the default first, as the price dialog offers them (#93). */
export function summarizeBudgetPricing(config: BudgetPricingConfig): SettingsSummaryItem[] {
  return config.profiles.map((profile, index) => ({
    id: `profile-${index}`,
    label: index === 0 ? `${profile.name} (default)` : profile.name,
    value: describeBudgetPricing(profile),
  }));
}

/** The top-level fields a change touched, in the order the new value lists them. */
export function changedFields(change: SettingsChange): string[] {
  // Each group's value is its own object type; the comparison only needs its top-level entries.
  const previous = new Map(Object.entries(change.previousValue ?? {}));
  const next = new Map(Object.entries(change.newValue));
  const keys = [...new Set([...next.keys(), ...previous.keys()])];
  return keys.filter((key) => JSON.stringify(previous.get(key)) !== JSON.stringify(next.get(key)));
}
