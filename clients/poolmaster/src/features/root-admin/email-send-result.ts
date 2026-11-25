import { EmailMessageStatus, EmailSkipReason, assertNever } from '@poolmaster/shared/domain';
import type { ToastMessage } from '@/features/shared/ui';
import type { EmailTestResponse } from '@/lib/api';

/**
 * Why a send was skipped, as a sentence telling the admin what to do. These are page sentences
 * (rules/ux-rules.md §16 item 2), not the reason's label, which is `enumLabel('EmailSkipReason', …)`.
 */
function skipReasonText(reason: EmailSkipReason): string {
  switch (reason) {
    case EmailSkipReason.EMAIL_DISABLED:
      return 'Not sent: "Send system email" is off. Turn it on in Email settings first.';
    case EmailSkipReason.TEMPLATE_DISABLED:
      return 'Not sent: this email is switched off.';
    case EmailSkipReason.NOT_ALLOWED_IN_ENVIRONMENT:
      return 'Not sent: the address is not in "Only send to", or is a reserved test domain.';
    case EmailSkipReason.SUPPRESSED:
      return 'Not sent: this address bounced or marked an email as spam before.';
    case EmailSkipReason.OPTED_OUT:
      return 'Not sent: the address\'s owner turned this kind of email off.';
    case EmailSkipReason.NOT_IN_PLAN:
      return 'Not sent: the league\'s plan doesn\'t include this email.';
    default:
      return assertNever(reason, 'email skip reason');
  }
}

/**
 * Where an email the admin sent themselves stands: the test email, or a copy of a send, which
 * carries no provider error.
 */
export type EmailSendResult = Pick<EmailTestResponse, 'skipReason' | 'status'> & Partial<Pick<EmailTestResponse, 'error'>>;

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
      return { tone: 'warning', text: result.skipReason ? skipReasonText(result.skipReason) : 'Not sent.' };
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
