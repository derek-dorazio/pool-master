import { Notice, Checkbox, FormField, Input, Text, Textarea } from '@/features/shared/ui';
import { SettingsSaveError } from './settings-save-error';
import type { EmailSettingsForm } from './use-email-settings-form';

/** The email settings' fields, without the dialog's Cancel and Save. */
export function EmailSettingsFields({ settings }: { settings: EmailSettingsForm }) {
  const { conflicted, form, loadLatest, saveMutation } = settings;
  const enabled = form.watch('enabled');

  return (
    <div className="space-y-4" data-testid="root-admin-email-settings-form">
      {enabled ? null : (
        <Notice data-testid="root-admin-email-settings-off-warning" title="Email is off" tone="warning">
          No system email is sent: invitations, welcomes, entry confirmations and contest notices are all skipped. Invites by email still succeed.
        </Notice>
      )}
      <label className="flex items-center gap-2">
        <Checkbox data-testid="root-admin-email-settings-enabled" {...form.register('enabled')} />
        <Text>Send system email</Text>
      </label>
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
        label="Weekly digest hour"
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
    </div>
  );
}
