import type { EmailConfig } from '@/lib/api';

export type SettingsSummaryItem = {
  id: string;
  label: string;
  value: string;
};

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
