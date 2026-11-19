import { LEAGUE_PLANS, PlanCap } from '@poolmaster/shared/domain';
import type { BillingConfig, EmailConfig, IngestionScheduleConfig, PlanConfig, SettingsChange } from '@/lib/api';
import { describeExpansionPrices, describePayments } from '@/features/billing/billing-format';
import { LEAGUE_PLAN_LABEL, PLAN_CAP_LABEL, formatPlanLimit } from '@/features/plans/plan-labels';

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
  return [
    { id: 'scheduledSports', label: 'Scheduled sports', value: config.scheduledSports.join(', ') },
    { id: 'eventLiveScores', label: 'Live scores', value: feedSummary(config.eventLiveScores) },
    { id: 'eventParticipants', label: 'Field sync', value: feedSummary(config.eventParticipants) },
    { id: 'eventList', label: 'Event list sync', value: feedSummary(config.eventList) },
    { id: 'healthCheck', label: 'Provider health check', value: feedSummary(config.healthCheck) },
  ];
}

/** The entry reminder offsets as a reader sees them, e.g. "48, 24, 3 hours before picks close". */
function formatReminderHours(hours: readonly number[]): string {
  return `${hours.join(', ')} hours before picks close`;
}

/** An hour of the day as a reader sees it, e.g. "3:00 AM". */
function formatHour(hour: number): string {
  return `${String(hour % 12 === 0 ? 12 : hour % 12)}:00 ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The email settings as the ⚙ Email settings dialog lists them (#1872); each email's own switch is its row's Status. */
export function summarizeEmail(config: EmailConfig): SettingsSummaryItem[] {
  return [
    { id: 'enabled', label: 'Email on/off', value: config.enabled ? 'On' : 'Off' },
    {
      id: 'allowedRecipients',
      label: 'Only send to',
      value: config.allowedRecipients.length > 0 ? config.allowedRecipients.join(', ') : 'Everyone',
    },
    { id: 'sendRatePerSecond', label: 'Emails a second', value: String(config.sendRatePerSecond) },
    { id: 'entryReminderHours', label: 'Entry reminders', value: formatReminderHours(config.entryReminderHours) },
    { id: 'standingsBufferMinutes', label: 'Standings email delay', value: `${String(config.standingsBufferMinutes)} minutes` },
    { id: 'weeklyDigestHour', label: 'Weekly digest hour', value: `Mondays at ${formatHour(config.weeklyDigestHour)} Eastern` },
  ];
}


/** Each plan cap's limit on every plan, Free to Platinum (#944). */
export function summarizePlans(config: PlanConfig, locale: string): SettingsSummaryItem[] {
  return Object.values(PlanCap).map((cap) => ({
    id: cap,
    label: PLAN_CAP_LABEL[cap],
    value: LEAGUE_PLANS.map((plan) => `${LEAGUE_PLAN_LABEL[plan]} ${formatPlanLimit(config.caps[cap][plan], locale)}`).join(' · '),
  }));
}

/** Whether payments are on, then each plan's expansion price list, Free to Platinum (#987). */
export function summarizeBilling(config: BillingConfig, locale: string): SettingsSummaryItem[] {
  return [
    { id: 'paymentsEnabled', label: 'Payments', value: describePayments(config) },
    ...LEAGUE_PLANS.map((plan) => ({
      id: `expansionPrices-${plan}`,
      label: `${LEAGUE_PLAN_LABEL[plan]} expansions`,
      value: describeExpansionPrices(config.expansionPrices[plan], locale),
    })),
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
