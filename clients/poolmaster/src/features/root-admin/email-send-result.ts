import { EmailMessageStatus, EmailSkipReason, assertNever } from '@poolmaster/shared/domain';
import type { ToastMessage } from '@/features/shared/ui';

const SKIP_REASON_TEXT: Record<EmailSkipReason, string> = {
  [EmailSkipReason.EMAIL_DISABLED]: 'Not sent: "Send system email" is off. Turn it on in Email settings first.',
  [EmailSkipReason.TEMPLATE_DISABLED]: 'Not sent: this email is switched off.',
  [EmailSkipReason.NOT_ALLOWED_IN_ENVIRONMENT]: 'Not sent: the address is not in "Only send to", or is a reserved test domain.',
  [EmailSkipReason.SUPPRESSED]: 'Not sent: this address bounced or marked an email as spam before.',
  [EmailSkipReason.OPTED_OUT]: 'Not sent: the address\'s owner turned this kind of email off.',
  [EmailSkipReason.NOT_IN_PLAN]: 'Not sent: the league\'s plan doesn\'t include this email.',
};

/** Where an email the admin sent themselves stands: the test email, or a copy of a send. */
export type EmailSendResult = {
  status: EmailMessageStatus;
  skipReason: EmailSkipReason | null;
  /** What the email provider said about a failed try, when there was one. */
  error?: string | null;
};

/** What happened to an email the admin sent themselves, in the admin's words. */
export function emailSendResultText(result: EmailSendResult): { tone: 'success' | 'warning' | 'danger'; text: string } {
  const providerSaid = result.error ? ` The email provider said: ${result.error}` : '';
  switch (result.status) {
    case EmailMessageStatus.SENT:
    case EmailMessageStatus.DELIVERED:
      return { tone: 'success', text: 'Sent. Check your inbox in a minute.' };
    case EmailMessageStatus.SENDING:
      return { tone: 'success', text: 'Being sent. Check your inbox in a minute.' };
    case EmailMessageStatus.QUEUED:
      return result.error
        ? { tone: 'danger', text: `The first try failed and it will be tried again.${providerSaid}` }
        : { tone: 'success', text: 'Waiting to be sent. Check your inbox in a few minutes.' };
    case EmailMessageStatus.SKIPPED:
      return { tone: 'warning', text: result.skipReason ? SKIP_REASON_TEXT[result.skipReason] : 'Not sent.' };
    case EmailMessageStatus.BOUNCED:
      return { tone: 'danger', text: 'Not delivered: your mail server refused it.' };
    case EmailMessageStatus.COMPLAINED:
      return { tone: 'warning', text: 'Delivered, but marked as spam.' };
    case EmailMessageStatus.FAILED:
      return { tone: 'danger', text: `Not sent.${providerSaid}` };
    default:
      return assertNever(result.status, 'email status');
  }
}

const TOAST_TONE = { success: 'success', warning: 'default', danger: 'danger' } as const satisfies Record<string, ToastMessage['tone']>;

/** The toast an email the admin sent themselves shows, titled by what was pressed. */
export function emailSendResultToast(title: string, result: EmailSendResult): ToastMessage {
  const { tone, text } = emailSendResultText(result);
  return { title, description: text, tone: TOAST_TONE[tone] };
}
