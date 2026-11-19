/**
 * The root admin's Notifications page (#1870): every system email with how it has gone out
 * lately, a preview of its latest send, and a copy of that send to the admin's own inbox.
 *
 * A preview is always a real email from the outbox, never sample data: an email nothing was sent
 * of, or whose sends no longer keep their content, has none (404 SYSTEM_EMAIL_NOT_SENT). A root
 * admin's copy is never a send here: not counted, not the last send, not previewed.
 */
import type { ApiErrorCode, EmailConfig } from '@poolmaster/shared/dto';
import type { EmailMessageRepository, SentEmailContent, UserRepository } from '@poolmaster/shared/db';
import {
  EmailTemplateKey,
  EmailTemplateStatus,
  type EmailMessage,
  type LeaguePlan,
  type PlanFeature,
} from '@poolmaster/shared/domain';
import type { PlanEntitlementsService } from '../plans/plan-entitlements-service';
import { emailRecipientOf, type EmailService } from './email-service';
import { withoutMemberLinks } from './member-link-redaction';
import { EMAIL_TEMPLATES, hasSettingsSwitch, type SystemEmailTemplateKey } from './system-email-templates';

/** How far back the sent counts and the latest send look: as long as the outbox keeps a row. */
export const SENT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One system email as the Notifications page lists it. */
export interface SystemEmailSummary {
  templateKey: SystemEmailTemplateKey;
  /** The plan feature a league needs for it, or null for an email every league gets. */
  planFeature: PlanFeature | null;
  /** The lowest plan with that feature, or null when there is none. */
  planStartsAt: LeaguePlan | null;
  status: EmailTemplateStatus;
  /** Sent in the last SENT_WINDOW_DAYS days. */
  sentCount: number;
  lastSentAt?: Date;
  /** When the send a preview shows went: the newest whose content is still kept. */
  previewSentAt?: Date;
}

/** No send of the email in the window still keeps its content: never sent, cleared, or a secret. */
export class SystemEmailNotSentError extends Error {
  readonly statusCode = 404;
  readonly code: ApiErrorCode = 'SYSTEM_EMAIL_NOT_SENT';

  constructor(templateKey: SystemEmailTemplateKey) {
    super(`No sent ${templateKey} email still keeps its content.`);
    this.name = 'SystemEmailNotSentError';
  }
}

/** The calling root admin's account is gone. */
export class SystemEmailRequesterNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code: ApiErrorCode = 'USER_NOT_FOUND';

  constructor(userId: string) {
    super(`User not found: ${userId}`);
    this.name = 'SystemEmailRequesterNotFoundError';
  }
}

export interface SystemEmailAdminServiceOptions {
  messages: Pick<EmailMessageRepository, 'summarizeSentSince' | 'findLatestSentWithContent'>;
  users: Pick<UserRepository, 'findById'>;
  email: Pick<EmailService, 'sendCopy'>;
  planEntitlements: Pick<PlanEntitlementsService, 'featureStartsAt'>;
  readConfig: () => EmailConfig;
  now?: () => Date;
}

export class SystemEmailAdminService {
  private readonly now: () => Date;

  constructor(private readonly options: SystemEmailAdminServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** Every system email, in EmailTemplateKey order, with its sends of the last 30 days. */
  async list(): Promise<SystemEmailSummary[]> {
    const config = this.options.readConfig();
    const sends = new Map((await this.options.messages.summarizeSentSince(this.windowStart()))
      .map((summary) => [summary.templateKey, summary]));
    return Object.values(EmailTemplateKey).map((templateKey) => {
      const { planFeature } = EMAIL_TEMPLATES[templateKey];
      const sent = sends.get(templateKey);
      return {
        templateKey,
        planFeature,
        planStartsAt: planFeature === null ? null : this.options.planEntitlements.featureStartsAt(planFeature),
        status: statusOf(config, templateKey),
        sentCount: sent?.sentCount ?? 0,
        lastSentAt: sent?.lastSentAt,
        previewSentAt: sent?.previewSentAt,
      };
    });
  }

  /**
   * The newest send of the email that still keeps its content, never a root admin's copy, with
   * the links that act for its recipient made dead (`withoutMemberLinks`).
   */
  async latestSend(templateKey: SystemEmailTemplateKey): Promise<SentEmailContent> {
    const latest = await this.options.messages.findLatestSentWithContent(templateKey, this.windowStart());
    if (!latest) throw new SystemEmailNotSentError(templateKey);
    return withoutMemberLinks(latest);
  }

  /**
   * Queues a copy of the email's latest send to root admin `adminUserId`'s own address, a new
   * email each press, and answers where it stands: QUEUED, or SKIPPED with the reason.
   */
  async sendLatestTo(templateKey: SystemEmailTemplateKey, adminUserId: string): Promise<EmailMessage> {
    const [latest, admin] = await Promise.all([
      this.latestSend(templateKey),
      this.options.users.findById(adminUserId),
    ]);
    if (!admin) throw new SystemEmailRequesterNotFoundError(adminUserId);
    return this.options.email.sendCopy(latest, emailRecipientOf(admin));
  }

  private windowStart(): Date {
    return new Date(this.now().getTime() - SENT_WINDOW_DAYS * DAY_MS);
  }
}

/** ON or OFF by the email's own switch, or ALWAYS_ON when it has none. */
function statusOf(config: EmailConfig, templateKey: SystemEmailTemplateKey): EmailTemplateStatus {
  if (!hasSettingsSwitch(templateKey)) return EmailTemplateStatus.ALWAYS_ON;
  return config.templates[templateKey] ? EmailTemplateStatus.ON : EmailTemplateStatus.OFF;
}
