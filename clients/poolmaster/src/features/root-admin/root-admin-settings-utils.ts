import { LEAGUE_PLANS, PlanCap } from '@poolmaster/shared/domain';
import type { BudgetPricingConfig, EmailConfig, IngestionScheduleConfig, PlanConfig, SettingsChange } from '@/lib/api';
import { LEAGUE_PLAN_LABEL, PLAN_CAP_LABEL, formatPlanLimit } from '@/features/plans/plan-labels';
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
  ['SQUAD_OWNER_INVITE', 'Co-owner invitation'],
  ['SQUAD_OWNER_ADDED', 'Added as a co-owner'],
  ['LEAGUE_MEMBER_JOINED', 'New member joined (commissioners)'],
  ['CONTEST_ENTRY_COMPLETED', 'Entry confirmation'],
  ['CONTEST_STARTED_SUMMARY', 'Contest started'],
  ['CONTEST_ENTRY_REMINDER', 'Entry reminders'],
  ['CONTEST_OPENED', 'New contest open'],
  ['CONTEST_STANDINGS', 'Live standings'],
  ['CONTEST_RESULTS', 'Final results'],
  ['CONTEST_EVENT_CHANGED', 'Event postponed or cancelled'],
  ['EVENT_COMING_UP', 'Event coming up (commissioners)'],
  ['EVENT_READY_FOR_CONTESTS', 'Event ready for contests (commissioners)'],
  ['EVENT_WEEKLY_DIGEST', 'Weekly event digest (commissioners)'],
  ['CONTEST_NOT_OPEN', 'Contest not open yet (commissioners)'],
  ['EVENT_STILL_DRAFT', 'Event still in draft (root admins)'],
  ['YEAR_IN_REVIEW', 'Year in review'],
];

/** The entry reminder offsets as a reader sees them, e.g. "48, 24, 3 hours before picks close". */
function formatReminderHours(hours: readonly number[]): string {
  return `${hours.join(', ')} hours before picks close`;
}

/** An hour of the day as a reader sees it, e.g. "3:00 AM". */
function formatHour(hour: number): string {
  return `${String(hour % 12 === 0 ? 12 : hour % 12)}:00 ${hour < 12 ? 'AM' : 'PM'}`;
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
    { id: 'weeklyDigestHour', label: 'Weekly event digest', value: `Mondays at ${formatHour(config.weeklyDigestHour)} Eastern` },
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

/** Each plan cap's limit on every plan, Free to Platinum (#944). */
export function summarizePlans(config: PlanConfig): SettingsSummaryItem[] {
  return Object.values(PlanCap).map((cap) => ({
    id: cap,
    label: PLAN_CAP_LABEL[cap],
    value: LEAGUE_PLANS.map((plan) => `${LEAGUE_PLAN_LABEL[plan]} ${formatPlanLimit(config.caps[cap][plan])}`).join(' · '),
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
