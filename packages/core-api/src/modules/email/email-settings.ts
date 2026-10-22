/**
 * EMAIL_CONFIG (#450): whether system email is sent, which templates are on, who it may go to,
 * and the Reply-To address. Root admins change it on /manage/settings; every core-api task sees
 * a save within the settings refresh. Transport and sender address stay in env
 * (`EMAIL_PROVIDER`, `SMTP_*`, `SES_*`), since they describe how the deployment is wired.
 */

import type { FastifyBaseLogger } from 'fastify';
import { EmailConfigSchema, EmailTemplateKeySchema } from '@poolmaster/shared/dto';
import type { EmailConfig } from '@poolmaster/shared/dto';
import { AppEnvironment, readAppEnv } from '../../core/config';
import { defineSettingsGroup } from '../platform/settings-group';
import {
  EmailSkipReason,
  type MailDeliveryMessage,
  type MailDeliveryProvider,
  type MailDeliveryResult,
} from './mail-delivery';

export const EMAIL_SETTINGS = defineSettingsGroup<EmailConfig>({
  key: 'EMAIL_CONFIG',
  title: 'Email',
  description: 'Whether system email is sent, which emails, who it may go to, and their Reply-To address.',
  schema: EmailConfigSchema,
  // QA sends nothing until a root admin turns it on, normally with an allow list; everywhere else must send.
  defaults: (env) => ({
    enabled: readAppEnv(env) !== AppEnvironment.QA,
    replyTo: null,
    allowedRecipients: [],
    templates: {
      LEAGUE_MEMBER_INVITE: true,
      LEAGUE_JOIN_SUCCESS: true,
      CONTEST_ENTRY_COMPLETED: true,
      CONTEST_STARTED_SUMMARY: true,
    },
  }),
});

/** What a route module that sends email is registered with: the app's one mail delivery. */
export interface MailModuleOptions {
  mailDelivery: MailDeliveryProvider;
}

/**
 * Domains reserved by RFC 2606 and RFC 6761: no mail server answers for them, so a real transport
 * would only collect hard bounces. The e2e smoke users on QA are `@e2e.invalid`.
 */
const RESERVED_TOP_LEVEL_DOMAINS = ['invalid', 'test', 'example', 'localhost'];
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];

/**
 * Wraps the transport and checks EMAIL_CONFIG on every send. An email that is switched off, or
 * whose every recipient is not allowed, is skipped and logged with ids only, never the body or
 * an address, and still reports success, so invite by email creates the invitation either way.
 * Recipients that are not allowed are dropped from an email that still has others.
 */
export class SettingsAwareMailDeliveryProvider implements MailDeliveryProvider {
  constructor(
    private readonly transport: MailDeliveryProvider,
    private readonly readConfig: () => EmailConfig,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  get providerName() {
    return this.transport.providerName;
  }

  send(message: MailDeliveryMessage): Promise<MailDeliveryResult> {
    const config = this.readConfig();
    const recipients = (Array.isArray(message.to) ? message.to : [message.to])
      .map((recipient) => recipient.trim())
      .filter(Boolean);
    const switchedOff = switchedOffReason(config, message.metadata?.templateKey);
    if (switchedOff) {
      return this.skip(message, switchedOff, recipients.length, 'Email is switched off in settings; skipped sending email');
    }
    const allowed = recipients.filter((recipient) => this.mayReceive(recipient, config));
    if (allowed.length === 0) {
      return this.skip(
        message,
        EmailSkipReason.NOT_ALLOWED_IN_ENVIRONMENT,
        recipients.length,
        'No recipient may be emailed in this environment; skipped sending email',
      );
    }
    if (allowed.length < recipients.length) {
      this.logger?.info({
        action: 'mailDelivery.skipRecipients',
        data: {
          reason: EmailSkipReason.NOT_ALLOWED_IN_ENVIRONMENT,
          toCount: recipients.length,
          skippedCount: recipients.length - allowed.length,
          ...messageRefs(message),
        },
      }, 'Some recipients may not be emailed in this environment; sending to the others');
    }
    return this.transport.send({
      ...message,
      to: allowed.length === recipients.length ? message.to : allowed,
      replyTo: message.replyTo ?? config.replyTo ?? undefined,
    });
  }

  /**
   * Reserved domains are refused only by SES, which delivers to the internet; Mailpit and the
   * test SMTP sink catch every address. The allow list applies on every transport.
   */
  private mayReceive(recipient: string, config: EmailConfig): boolean {
    const address = recipient.toLowerCase();
    if (this.transport.providerName === 'ses' && isReservedDomain(domainOf(address))) {
      return false;
    }
    if (config.allowedRecipients.length === 0) return true;
    return config.allowedRecipients.some((pattern) => (
      pattern.startsWith('@') ? address.endsWith(pattern) : address === pattern
    ));
  }

  private skip(
    message: MailDeliveryMessage,
    reason: EmailSkipReason,
    toCount: number,
    logMessage: string,
  ): Promise<MailDeliveryResult> {
    this.logger?.info({
      action: 'mailDelivery.skip',
      data: { reason, toCount, ...messageRefs(message) },
    }, logMessage);
    return Promise.resolve({ provider: this.transport.providerName, skipped: reason });
  }
}

function messageRefs(message: MailDeliveryMessage) {
  return {
    templateKey: message.metadata?.templateKey ?? null,
    leagueId: message.metadata?.leagueId ?? null,
    contestId: message.metadata?.contestId ?? null,
    entryId: message.metadata?.entryId ?? null,
    invitationId: message.metadata?.invitationId ?? null,
  };
}

function switchedOffReason(config: EmailConfig, templateKey: string | undefined): EmailSkipReason | undefined {
  if (!config.enabled) return EmailSkipReason.EMAIL_DISABLED;
  const template = EmailTemplateKeySchema.safeParse(templateKey);
  if (template.success && !config.templates[template.data]) return EmailSkipReason.TEMPLATE_DISABLED;
  return undefined;
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1);
}

function isReservedDomain(domain: string): boolean {
  const topLevel = domain.slice(domain.lastIndexOf('.') + 1);
  return RESERVED_TOP_LEVEL_DOMAINS.includes(topLevel)
    || RESERVED_DOMAINS.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`));
}
