import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { EmailConfigSchema, EmailRecipientPatternSchema } from '@poolmaster/shared/dto';
import type { EmailConfig, SettingsGroup } from '@/lib/api';
import { Alert, Button, Checkbox, FormField, Input, Textarea } from '@/features/shared/ui';
import { numberFieldErrors } from '@/lib/number-field-errors';
import { EMAIL_TEMPLATE_LABELS } from './root-admin-settings-utils';
import { SettingsSaveError } from './settings-save-error';
import { useSettingsGroupForm } from './use-settings-group-form';

type EmailSettingsGroup = Extract<SettingsGroup, { key: 'EMAIL_CONFIG' }>;

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

/**
 * The EMAIL_CONFIG card's form (#450). The draft is taken from the group once, when the card
 * mounts, so a background refetch never overwrites an admin's edits; the save sends the
 * `updatedAt` the draft was taken from, and a 409 offers to fetch and load the newer value.
 */
export function EmailSettingsForm({ group }: { group: EmailSettingsGroup }) {
  const { conflicted, form, loadLatest, saveMutation, submit } = useSettingsGroupForm({
    group,
    resolver: zodResolver(EmailSettingsFormSchema, { error: emailErrors }),
    subject: 'Email settings',
    toForm: toFormValues,
    toValue: toConfig,
  });

  const enabled = form.watch('enabled');

  return (
    <form
      className="space-y-4"
      data-testid="root-admin-email-settings-form"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      {enabled ? null : (
        <Alert data-testid="root-admin-email-settings-off-warning" title="Email is off" tone="warning">
          No system email is sent: invitations, welcomes, entry confirmations and contest notices are all skipped. Invites by email still succeed.
        </Alert>
      )}
      <label className="flex items-center gap-2 text-sm">
        <Checkbox data-testid="root-admin-email-settings-enabled" {...form.register('enabled')} />
        Send system email
      </label>
      <fieldset className="space-y-2" disabled={!enabled}>
        <legend className="text-sm font-medium">Emails</legend>
        {EMAIL_TEMPLATE_LABELS.map(([key, label]) => (
          <label className="flex items-center gap-2 text-sm" key={key}>
            <Checkbox data-testid={`root-admin-email-settings-template-${key}`} {...form.register(`templates.${key}`)} />
            {label}
          </label>
        ))}
      </fieldset>
      <FormField
        error={form.formState.errors.allowedRecipients?.message}
        helperText="One address or @domain per line. When the list is not empty, email goes only to these recipients and every other one is skipped. Leave it empty to email everyone."
        label="Only send to"
      >
        <Textarea data-testid="root-admin-email-settings-allowed-recipients" rows={4} {...form.register('allowedRecipients')} />
      </FormField>
      <FormField
        error={form.formState.errors.sendRatePerSecond?.message}
        helperText="The most emails each server sends a second, from 1 to 100. Keep the total for all servers within the SES sending rate."
        label="Emails a second"
      >
        <Input
          data-testid="root-admin-email-settings-send-rate"
          inputMode="numeric"
          max={100}
          min={1}
          type="number"
          {...form.register('sendRatePerSecond', { valueAsNumber: true })}
        />
      </FormField>
      <FormField
        error={form.formState.errors.entryReminderHours?.message}
        helperText="Hours before a contest's picks close, separated by commas. Each reminder goes to every member with nothing submitted, all at the same moment."
        label="Entry reminders"
      >
        <Input data-testid="root-admin-email-settings-reminder-hours" {...form.register('entryReminderHours')} />
      </FormField>
      <FormField
        error={form.formState.errors.standingsBufferMinutes?.message}
        helperText="Minutes after a round or event finishes before its standings email goes, from 0 to 240, so a late score correction lands first."
        label="Standings email delay"
      >
        <Input
          data-testid="root-admin-email-settings-standings-buffer"
          inputMode="numeric"
          max={240}
          min={0}
          type="number"
          {...form.register('standingsBufferMinutes', { valueAsNumber: true })}
        />
      </FormField>
      <FormField
        error={form.formState.errors.weeklyDigestHour?.message}
        helperText="The hour, from 0 to 23 in US Eastern time, every league's weekly event digest goes on Monday, and a busy day's new members are told the next day."
        label="Weekly event digest hour"
      >
        <Input
          data-testid="root-admin-email-settings-digest-hour"
          inputMode="numeric"
          max={23}
          min={0}
          type="number"
          {...form.register('weeklyDigestHour', { valueAsNumber: true })}
        />
      </FormField>
      <SettingsSaveError
        conflicted={conflicted}
        error={saveMutation.error}
        fallback="We could not save the email settings."
        onLoadLatest={loadLatest}
        testId="root-admin-email-settings-error"
      />
      <Button data-testid="root-admin-email-settings-save" disabled={saveMutation.isPending} type="submit">
        {saveMutation.isPending ? 'Saving...' : 'Save email settings'}
      </Button>
    </form>
  );
}
