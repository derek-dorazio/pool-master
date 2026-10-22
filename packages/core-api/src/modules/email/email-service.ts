/**
 * The one way core-api sends a system email (#844): `emailService.send(templateKey, input)`.
 * It checks EMAIL_CONFIG and who may be emailed here, renders the template for the recipient,
 * picks the sender (the league's address for a league email, the app's otherwise) and hands
 * the email to the transport. Callers never render or call a transport themselves.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { EmailConfig } from '@poolmaster/shared/dto';
import {
  EmailSkipReason,
  type MailAddress,
  type MailDeliveryProvider,
  type MailDeliveryResult,
} from './mail-delivery';
import {
  hasSettingsSwitch,
  PLATFORM_SENDER_NAME,
  renderSystemEmailTemplate,
  type EmailTemplateScopeByKey,
  type SystemEmailTemplateDataByKey,
  type SystemEmailTemplateKey,
} from './system-email-templates';

/** The person an email goes to. */
export interface EmailRecipient {
  email: string;
  /** The recipient's IANA time zone, when they have one; dates are shown in UTC otherwise. */
  timeZone?: string | null;
}

/** The league a league email is about: it comes from this league's address, in its name. */
export interface EmailLeague {
  id: string;
  name: string;
  leagueCode: string;
}

/** What else the email is about, for the log and, from slice 3, the sent record. */
export interface EmailRefs {
  contestId?: string;
  entryId?: string;
  invitationId?: string;
}

type LeagueOf<Key extends SystemEmailTemplateKey> =
  EmailTemplateScopeByKey[Key] extends 'LEAGUE'
    ? { league: EmailLeague }
    : { league?: never };

export type EmailSendInput<Key extends SystemEmailTemplateKey> = {
  to: EmailRecipient;
  data: SystemEmailTemplateDataByKey[Key];
  refs?: EmailRefs;
} & LeagueOf<Key>;

/**
 * League codes that are role addresses (RFC 2142 and common practice). A league can't take one,
 * since its email would come from that address.
 */
export const RESERVED_LEAGUE_CODES: ReadonlySet<string> = new Set([
  'NOREPLY',
  'POSTMASTER',
  'ABUSE',
  'ADMIN',
  'SUPPORT',
  'SECURITY',
  'BOUNCE',
  'HOSTMASTER',
  'WEBMASTER',
]);

/**
 * Domains reserved by RFC 2606 and RFC 6761: no mail server answers for them, so a real transport
 * would only collect hard bounces. The e2e smoke users on QA are `@e2e.invalid`.
 */
const RESERVED_TOP_LEVEL_DOMAINS = ['invalid', 'test', 'example', 'localhost'];
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];

const DEFAULT_TIME_ZONE = 'UTC';

export interface EmailServiceOptions {
  transport: MailDeliveryProvider;
  readConfig: () => EmailConfig;
  /** The environment's `noreply@` address. League addresses share its domain. */
  senderAddress: string;
  logger?: FastifyBaseLogger;
}

export class EmailService {
  private readonly sendingDomain: string;

  constructor(private readonly options: EmailServiceOptions) {
    this.sendingDomain = domainOf(options.senderAddress);
  }

  /**
   * Sends one email to one person. An email that is switched off, or to a recipient who may not
   * be emailed here, is skipped and logged with ids only, never the body or the address, and
   * still reports success, so invite by email creates the invitation either way. A transport
   * failure is thrown for the caller to handle.
   */
  async send<Key extends SystemEmailTemplateKey>(
    templateKey: Key,
    input: EmailSendInput<Key>,
  ): Promise<MailDeliveryResult> {
    const config = this.options.readConfig();
    const league: EmailLeague | undefined = input.league;
    const metadata = {
      templateKey,
      leagueId: league?.id,
      contestId: input.refs?.contestId,
      entryId: input.refs?.entryId,
      invitationId: input.refs?.invitationId,
    };
    const address = input.to.email.trim();
    const skipped = switchedOffReason(config, templateKey)
      ?? (this.mayReceive(address, config) ? undefined : EmailSkipReason.NOT_ALLOWED_IN_ENVIRONMENT);
    if (skipped) {
      this.options.logger?.info({
        action: 'email.send.skip',
        data: { reason: skipped, ...logRefs(metadata) },
      }, skipped === EmailSkipReason.NOT_ALLOWED_IN_ENVIRONMENT
        ? 'Recipient may not be emailed in this environment; skipped sending email'
        : 'Email is switched off in settings; skipped sending email');
      return { provider: this.options.transport.providerName, skipped };
    }

    const message = renderSystemEmailTemplate(templateKey, input.data, {
      timeZone: this.resolveTimeZone(input.to.timeZone, metadata),
    });
    return this.options.transport.send({
      from: this.senderFor(league),
      to: address,
      subject: message.subject,
      text: message.text,
      html: message.html,
      metadata,
    });
  }

  /**
   * A league email comes from `<league code>@<sending domain>` in the league's name; nothing
   * receives mail there. A league whose code is a role address (one created before codes were
   * reserved) sends from the `noreply@` address instead, still in its name.
   */
  private senderFor(league: EmailLeague | undefined): MailAddress {
    if (!league) {
      return { name: PLATFORM_SENDER_NAME, address: this.options.senderAddress };
    }
    const code = league.leagueCode.toUpperCase();
    return {
      name: league.name,
      address: RESERVED_LEAGUE_CODES.has(code)
        ? this.options.senderAddress
        : `${code.toLowerCase()}@${this.sendingDomain}`,
    };
  }

  /**
   * The recipient's time zone, or UTC when they have none. A stored zone the runtime doesn't
   * know is logged and shown as UTC rather than failing the email.
   */
  private resolveTimeZone(timeZone: string | null | undefined, metadata: Parameters<typeof logRefs>[0]): string {
    if (!timeZone) return DEFAULT_TIME_ZONE;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return timeZone;
    } catch (err) {
      this.options.logger?.warn({
        action: 'email.send.unknownTimeZone',
        data: { timeZone, ...logRefs(metadata), error: err instanceof Error ? err.message : String(err) },
      }, 'Recipient time zone is unknown; showing dates in UTC');
      return DEFAULT_TIME_ZONE;
    }
  }

  /**
   * Reserved domains are refused only by SES, which delivers to the internet; Mailpit and the
   * test SMTP sink catch every address. The allow list applies on every transport.
   */
  private mayReceive(address: string, config: EmailConfig): boolean {
    const normalized = address.toLowerCase();
    if (this.options.transport.providerName === 'ses' && isReservedDomain(domainOf(normalized))) {
      return false;
    }
    if (config.allowedRecipients.length === 0) return true;
    return config.allowedRecipients.some((pattern) => (
      pattern.startsWith('@') ? normalized.endsWith(pattern) : normalized === pattern
    ));
  }
}

function logRefs(metadata: { templateKey: string } & EmailRefs & { leagueId?: string }) {
  return {
    templateKey: metadata.templateKey,
    leagueId: metadata.leagueId ?? null,
    contestId: metadata.contestId ?? null,
    entryId: metadata.entryId ?? null,
    invitationId: metadata.invitationId ?? null,
  };
}

function switchedOffReason(config: EmailConfig, templateKey: SystemEmailTemplateKey): EmailSkipReason | undefined {
  if (!config.enabled) return EmailSkipReason.EMAIL_DISABLED;
  if (hasSettingsSwitch(templateKey) && !config.templates[templateKey]) return EmailSkipReason.TEMPLATE_DISABLED;
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
