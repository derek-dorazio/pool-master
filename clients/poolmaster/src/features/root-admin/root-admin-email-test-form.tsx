import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { EmailMessageStatus, EmailSkipReason } from '@poolmaster/shared/domain';
import { EmailTestRequestSchema } from '@poolmaster/shared/dto';
import { sendTestEmail, type EmailTestRequest, type EmailTestResponse } from '@/lib/api';
import { Alert, Button, FormField, Input } from '@/features/shared/ui';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { extractErrorMessage, throwApiError } from '@/lib/errors';

const SKIP_REASON_TEXT: Record<EmailSkipReason, string> = {
  [EmailSkipReason.EMAIL_DISABLED]: 'Not sent: "Send system email" is off. Turn it on and save first.',
  [EmailSkipReason.TEMPLATE_DISABLED]: 'Not sent: this email is switched off.',
  [EmailSkipReason.NOT_ALLOWED_IN_ENVIRONMENT]: 'Not sent: the address is not in "Only send to", or is a reserved test domain.',
  [EmailSkipReason.SUPPRESSED]: 'Not sent: this address bounced or marked an email as spam before.',
  [EmailSkipReason.OPTED_OUT]: 'Not sent: the address\'s owner turned this kind of email off.',
};

/** What happened to the test email, in the admin's words. */
function resultText(result: EmailTestResponse): { tone: 'success' | 'warning' | 'danger'; text: string } {
  if (result.status === EmailMessageStatus.SENT) {
    return { tone: 'success', text: 'Sent. Check the inbox in a minute.' };
  }
  if (result.status === EmailMessageStatus.SKIPPED) {
    return { tone: 'warning', text: result.skipReason ? SKIP_REASON_TEXT[result.skipReason] : 'Not sent.' };
  }
  const error = result.error ? ` The email provider said: ${result.error}` : '';
  return result.status === EmailMessageStatus.FAILED
    ? { tone: 'danger', text: `Not sent.${error}` }
    : { tone: 'danger', text: `The first try failed and it will be tried again.${error}` };
}

/**
 * Sends one fixed test email (#910) through the saved email settings, to check the setup works:
 * the switch, "Only send to" and the email provider. It uses the settings as saved, not this
 * page's unsaved edits.
 */
export function EmailTestForm() {
  const form = useForm<EmailTestRequest>({
    resolver: zodResolver(EmailTestRequestSchema),
    defaultValues: { to: '' },
  });

  const sendMutation = useInvalidatingMutation({
    mutationFn: async (values: EmailTestRequest) => {
      const response = await sendTestEmail({ body: values });
      if (!response.data) {
        throwApiError(response.error, 'Test email response is missing data.');
      }
      return response.data;
    },
    invalidates: [],
  });

  const result = sendMutation.data ? resultText(sendMutation.data) : undefined;

  return (
    <form
      className="space-y-3 border-t border-border pt-4"
      data-testid="root-admin-email-test-form"
      noValidate
      onSubmit={(event) => void form.handleSubmit((values) => sendMutation.mutate(values))(event)}
    >
      <FormField
        error={form.formState.errors.to?.message}
        helperText="Sends one short test email using the saved settings above, to check email is working."
        label="Send a test email to"
      >
        <Input data-testid="root-admin-email-test-to" inputMode="email" type="email" {...form.register('to')} />
      </FormField>
      {result ? (
        <Alert data-testid="root-admin-email-test-result" tone={result.tone}>{result.text}</Alert>
      ) : null}
      {sendMutation.isError ? (
        <Alert data-testid="root-admin-email-test-error" tone="danger">
          {extractErrorMessage(sendMutation.error, { fallback: 'We could not send the test email.' })}
        </Alert>
      ) : null}
      <Button data-testid="root-admin-email-test-send" disabled={sendMutation.isPending} type="submit" variant="secondary">
        {sendMutation.isPending ? 'Sending...' : 'Send test email'}
      </Button>
    </form>
  );
}
