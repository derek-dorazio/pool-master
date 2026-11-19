/**
 * Maps the root admin's Notifications page reads (#1870): each system email with its recent
 * sends, the latest send with its recipient masked, and where a copy sent to the admin stands.
 */
import type { SentEmailContent } from '@poolmaster/shared/db';
import type {
  SystemEmailDto,
  SystemEmailLatestSendResponse,
  SystemEmailResendResponse,
} from '@poolmaster/shared/dto';
import type { EmailMessage } from '@poolmaster/shared/domain';
import type { SystemEmailSummary } from '../modules/email/system-email-admin-service';

export function toSystemEmailDto(summary: SystemEmailSummary): SystemEmailDto {
  return {
    templateKey: summary.templateKey,
    planFeature: summary.planFeature,
    planStartsAt: summary.planStartsAt,
    status: summary.status,
    sentLast30Days: summary.sentCount,
    lastSentAt: summary.lastSentAt?.toISOString() ?? null,
    previewSentAt: summary.previewSentAt?.toISOString() ?? null,
  };
}

export function toSystemEmailLatestSendDto(sent: SentEmailContent): SystemEmailLatestSendResponse {
  return {
    templateKey: sent.templateKey,
    subject: sent.subject,
    htmlBody: sent.htmlBody,
    sentAt: sent.sentAt.toISOString(),
    recipient: maskEmailAddress(sent.recipientEmail),
  };
}

export function toSystemEmailResendDto(message: EmailMessage): SystemEmailResendResponse {
  return { status: message.status, skipReason: message.skipReason ?? null };
}

/** The address's first character, a mask for the rest of its local part, then the domain: "d•••@example.com". */
export function maskEmailAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '•••';
  return `${address[0]}•••${address.slice(at)}`;
}
