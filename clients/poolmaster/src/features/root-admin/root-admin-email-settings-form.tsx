import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { EmailConfigSchema, EmailRecipientPatternSchema } from '@poolmaster/shared/dto';
import { updateSettingsGroup, type EmailConfig, type SettingsGroup } from '@/lib/api';
import { Alert, Button, Checkbox, FormField, Textarea } from '@/features/shared/ui';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { hasErrorCode, throwApiError, extractErrorMessage } from '@/lib/errors';
import { EMAIL_TEMPLATE_LABELS } from './root-admin-settings-utils';

type EmailSettingsGroup = Extract<SettingsGroup, { key: 'EMAIL_CONFIG' }>;

/** One allowed recipient per line; blank lines are ignored. */
function recipientLines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

/** The stored shape, except that the allowed recipients are one box, one address or @domain per line. */
const EmailSettingsFormSchema = EmailConfigSchema.extend({
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

function toFormValues(config: EmailConfig): EmailSettingsFormValues {
  return {
    ...config,
    templates: { ...config.templates },
    allowedRecipients: config.allowedRecipients.join('\n'),
  };
}

function toConfig(values: EmailSettingsFormValues): EmailConfig {
  return {
    ...values,
    allowedRecipients: recipientLines(values.allowedRecipients)
      .map((line) => EmailRecipientPatternSchema.parse(line)),
  };
}

/**
 * The EMAIL_CONFIG card's form (#450). The draft is taken from the group once, when the card
 * mounts, so a background refetch never overwrites an admin's edits; the save sends the
 * `updatedAt` the draft was taken from, and a 409 offers to fetch and load the newer value.
 */
export function EmailSettingsForm({ group }: { group: EmailSettingsGroup }) {
  const queryClient = useQueryClient();
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(group.updatedAt);
  const form = useForm<EmailSettingsFormValues>({
    resolver: zodResolver(EmailSettingsFormSchema),
    defaultValues: toFormValues(group.value),
  });

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (values: EmailSettingsFormValues) => {
      const response = await updateSettingsGroup({
        path: { key: 'EMAIL_CONFIG' },
        body: {
          key: 'EMAIL_CONFIG',
          value: toConfig(values),
          expectedUpdatedAt: baseUpdatedAt,
        },
      });
      if (response.data?.key !== 'EMAIL_CONFIG') {
        throwApiError(response.error, 'Email settings response is missing data.');
      }
      return response.data;
    },
    onSuccess: (saved) => {
      setBaseUpdatedAt(saved.updatedAt);
      form.reset(toFormValues(saved.value));
    },
    invalidates: [QueryKeys.rootAdmin.settings],
  });

  const conflicted = hasErrorCode(saveMutation.error, 'SETTINGS_CONFLICT');

  // A 409 refetches nothing (invalidation runs on success only), so the `group` prop is still
  // the version that conflicted: fetch the settings again and start the draft from that.
  async function loadLatest() {
    await queryClient.refetchQueries({ queryKey: QueryKeys.rootAdmin.settings, exact: true });
    const latest = queryClient
      .getQueryData<SettingsGroup[]>(QueryKeys.rootAdmin.settings)
      ?.find((candidate): candidate is EmailSettingsGroup => candidate.key === 'EMAIL_CONFIG');
    if (!latest) {
      return;
    }
    setBaseUpdatedAt(latest.updatedAt);
    form.reset(toFormValues(latest.value));
    saveMutation.reset();
  }

  const enabled = form.watch('enabled');

  return (
    <form
      className="space-y-4"
      data-testid="root-admin-email-settings-form"
      noValidate
      onSubmit={(event) => void form.handleSubmit((values) => saveMutation.mutate(values))(event)}
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
      {saveMutation.isError ? (
        <Alert
          action={conflicted ? (
            <Button onClick={() => void loadLatest()} type="button" variant="secondary">
              Load the latest settings
            </Button>
          ) : undefined}
          data-testid="root-admin-email-settings-error"
          tone="danger"
        >
          {extractErrorMessage(saveMutation.error, { fallback: 'We could not save the email settings.' })}
        </Alert>
      ) : null}
      <Button data-testid="root-admin-email-settings-save" disabled={saveMutation.isPending} type="submit">
        {saveMutation.isPending ? 'Saving...' : 'Save email settings'}
      </Button>
    </form>
  );
}
