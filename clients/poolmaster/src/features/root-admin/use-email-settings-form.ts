import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { EmailConfigSchema, EmailRecipientPatternSchema } from '@poolmaster/shared/dto';
import type { EmailConfig, SettingsGroup } from '@/lib/api';
import { numberFieldErrors } from '@/lib/number-field-errors';
import { useSettingsGroupForm } from './use-settings-group-form';

export type EmailSettingsGroup = Extract<SettingsGroup, { key: 'EMAIL_CONFIG' }>;

/** One allowed recipient per line; blank lines are ignored. */
function recipientLines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

/** Comma-separated hours; blanks are ignored. */
function reminderHourItems(text: string): string[] {
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}

const ReminderHoursSchema = EmailConfigSchema.shape.entryReminderHours;

/**
 * The stored shape, except that the allowed recipients are one box, one address or @domain per
 * line, and the entry reminders one box of comma-separated hours.
 */
const EmailSettingsFormSchema = EmailConfigSchema.extend({
  entryReminderHours: z.string().superRefine((text, context) => {
    const parsed = ReminderHoursSchema.safeParse(reminderHourItems(text).map(Number));
    if (!parsed.success) {
      context.addIssue({ code: 'custom', message: 'List 1 to 5 whole numbers of hours from 1 to 168, separated by commas.' });
    }
  }),
  allowedRecipients: z.string().superRefine((text, context) => {
    const lines = recipientLines(text);
    const invalid = lines.find((line) => !EmailRecipientPatternSchema.safeParse(line).success);
    if (invalid !== undefined) {
      context.addIssue({ code: 'custom', message: `"${invalid}" is not an email address or @domain.` });
    } else if (lines.length > 100) {
      context.addIssue({ code: 'custom', message: 'List at most 100 addresses or domains.' });
    }
  }),
});
type EmailSettingsFormValues = z.infer<typeof EmailSettingsFormSchema>;

const emailErrors = numberFieldErrors({
  sendRatePerSecond: {
    schema: EmailConfigSchema.shape.sendRatePerSecond,
    range: (min, max) => `From ${min} to ${max} emails a second.`,
    blank: 'Enter a number of emails a second.',
    whole: 'Whole emails a second only.',
  },
  standingsBufferMinutes: {
    schema: EmailConfigSchema.shape.standingsBufferMinutes,
    range: (min, max) => `From ${min} to ${max} minutes.`,
    blank: 'Enter a number of minutes.',
    whole: 'Whole minutes only.',
  },
  weeklyDigestHour: {
    schema: EmailConfigSchema.shape.weeklyDigestHour,
    range: (min, max) => `An hour from ${min} to ${max}.`,
    blank: 'Enter an hour.',
    whole: 'A whole hour only.',
  },
});

function toFormValues(config: EmailConfig): EmailSettingsFormValues {
  return {
    ...config,
    templates: { ...config.templates },
    allowedRecipients: config.allowedRecipients.join('\n'),
    entryReminderHours: config.entryReminderHours.join(', '),
  };
}

function toConfig(values: EmailSettingsFormValues): EmailConfig {
  return {
    ...values,
    allowedRecipients: recipientLines(values.allowedRecipients)
      .map((line) => EmailRecipientPatternSchema.parse(line)),
    entryReminderHours: ReminderHoursSchema.parse(reminderHourItems(values.entryReminderHours).map(Number)),
  };
}

export type EmailSettingsForm = ReturnType<typeof useEmailSettingsForm>;

/**
 * The email settings' form (#450, #1872), for the ⚙ Email settings dialog's Edit. The draft is
 * taken from the group once, when the dialog opens, so a background refetch never overwrites an
 * admin's edits; the save sends the `updatedAt` the draft was taken from, and a 409 offers to
 * fetch and load the newer value. Each email's own switch is edited from its row, not here.
 */
export function useEmailSettingsForm(group: EmailSettingsGroup) {
  return useSettingsGroupForm({
    group,
    resolver: zodResolver(EmailSettingsFormSchema, { error: emailErrors }),
    subject: 'Email settings',
    toForm: toFormValues,
    toValue: toConfig,
  });
}

/** The draft's values for the group as it is now, which Edit starts from. */
export function emailSettingsFormValues(group: EmailSettingsGroup): EmailSettingsFormValues {
  return toFormValues(group.value);
}
