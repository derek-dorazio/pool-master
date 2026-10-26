/**
 * The one way core-api sends a system email (#844): `emailService.send(templateKey, input)`.
 * It checks EMAIL_CONFIG and who may be emailed here, renders the template for the recipient,
 * picks the sender (the league's address for a league email, the app's otherwise) and records
 * the email in the outbox, queued for the sender or skipped with the reason. Callers never
 * render or call a transport themselves.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { EmailConfig } from '@poolmaster/shared/dto';
import type {
  EmailMessageRepository,
  EmailMessageState,
  EmailOptOutRepository,
  EmailSuppressionRepository,
} from '@poolmaster/shared/db';
import {
  DEFAULT_DISPLAY_LOCALE,
  DEFAULT_DISPLAY_TIME_ZONE,
  EmailMessageStatus,
  EmailSkipReason,
  EmailTemplateKey,
  isKnownLocale,
  isKnownTimeZone,
  isOptionalEmailCategory,
  TimeFormat,
  type EmailMessage,
  type LeaguePlan,
  type OptionalEmailCategory,
  type User,
} from '@poolmaster/shared/domain';
import type { PlanEntitlementsService } from '../plans/plan-entitlements-service';
import type { MailAddress, MailDeliveryProviderName } from './mail-delivery';
import {
  EMAIL_TEMPLATES,
  hasSettingsSwitch,
  PLATFORM_SENDER_NAME,
  renderSystemEmailTemplate,
  type EmailTemplateScope,
  type EmailTemplateScopeByKey,
  type SystemEmailTemplateDataByKey,
  type SystemEmailTemplateKey,
} from './system-email-templates';
import type { UnsubscribeTokens } from './unsubscribe-tokens';

/** The person an email goes to. */
export interface EmailRecipient {
  email: string;
  /** Their account, when they have one; an invite goes to an address with none yet. */
  userId?: string;
  /** The recipient's IANA time zone, when they have one; dates are shown in US Eastern otherwise. */
  timeZone?: string | null;
  /** The recipient's locale, when they have one; dates are written en-US otherwise. */
  locale?: string | null;
  /** The recipient's clock, when they chose one; the locale's own otherwise. */
  timeFormat?: TimeFormat | null;
}

/** A member as an email recipient: their address, account and how they read dates. */
export function emailRecipientOf(user: Pick<User, 'id' | 'email' | 'timezone' | 'locale' | 'timeFormat'>): EmailRecipient {
  return {
    email: user.email,
    userId: user.id,
    timeZone: user.timezone,
    locale: user.locale,
    timeFormat: user.timeFormat,
  };
}

/**
 * The league a league email is about: it comes from this league's address, in its name, and is
 * sent only when the plan the league is on has the email's plan feature.
 */
export interface EmailLeague {
  id: string;
  name: string;
  leagueCode: string;
  plan: LeaguePlan;
}

/** What else the email is about, for the log and the outbox row. */
export interface EmailRefs {
  contestId?: string;
  entryId?: string;
  invitationId?: string;
}

type LeagueOf<Key extends SystemEmailTemplateKey> =
  EmailTemplateScopeByKey[Key] extends typeof EmailTemplateScope.LEAGUE
    ? { league: EmailLeague }
    : { league?: never };

export type EmailSendInput<Key extends SystemEmailTemplateKey> = {
  to: EmailRecipient;
  /**
   * What this one email is about, such as an invitation and its code: with the template and the
   * recipient it makes the idempotency key, so the same email is recorded once however often
   * the action that sends it runs. Something the person asked to have sent again is a new subject.
   */
  about: string;
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

const SKIP_LOG_MESSAGES: Record<EmailSkipReason, string> = {
  [EmailSkipReason.EMAIL_DISABLED]: 'Email is switched off in settings; skipped sending email',
  [EmailSkipReason.TEMPLATE_DISABLED]: 'Email is switched off in settings; skipped sending email',
  [EmailSkipReason.NOT_ALLOWED_IN_ENVIRONMENT]: 'Recipient may not be emailed in this environment; skipped sending email',
  [EmailSkipReason.SUPPRESSED]: 'Recipient bounced or complained before; skipped sending email',
  [EmailSkipReason.OPTED_OUT]: 'Recipient turned this kind of email off; skipped sending email',
  [EmailSkipReason.NOT_IN_PLAN]: 'League plan does not include this email; skipped sending email',
};

/** Where an email's "Stop these emails" page and one-click unsubscribe live (#844 slice 5). */
export const UNSUBSCRIBE_PAGE_PATH = '/email/unsubscribe';
export const ONE_CLICK_UNSUBSCRIBE_PATH = '/api/v1/email/unsubscribe';

export interface EmailServiceOptions {
  messages: Pick<EmailMessageRepository, 'record' | 'existsForContest' | 'findLeagueIdsRecorded' | 'findLatestStateByInvitations'>;
  /** Addresses that bounced for good or complained: their email is skipped, not queued. */
  suppressions: Pick<EmailSuppressionRepository, 'findByEmail'>;
  /** Categories each user turned off: their email in one is skipped, not queued. */
  optOuts: Pick<EmailOptOutRepository, 'isOptedOut'>;
  /** Signs the unsubscribe links an email a member can turn off carries, under `appBaseUrl`. */
  unsubscribe: { tokens: UnsubscribeTokens; appBaseUrl: string };
  /** Which transport sends: reserved domains are skipped only on SES. */
  providerName: MailDeliveryProviderName;
  readConfig: () => EmailConfig;
  /** What each plan has (#948): a league email whose plan feature the league's plan lacks is skipped. */
  planEntitlements: Pick<PlanEntitlementsService, 'forPlan'>;
  /** The environment's `noreply@` address. League addresses share its domain. */
  senderAddress: string;
  /** Called once an email is queued, to wake the sender. */
  onQueued?: () => void;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

export class EmailService {
  private readonly sendingDomain: string;

  constructor(private readonly options: EmailServiceOptions) {
    this.sendingDomain = domainOf(options.senderAddress);
  }

  /**
   * Records one email to one person: queued with its content, or skipped, logged with ids only
   * (never the body or the address), when it is switched off or the recipient may not be emailed
   * here. An email already recorded under the same key is returned as it stands and not queued
   * again. A failed write is thrown for the caller to handle.
   */
  async send<Key extends SystemEmailTemplateKey>(
    templateKey: Key,
    input: EmailSendInput<Key>,
  ): Promise<EmailMessage> {
    const config = this.options.readConfig();
    const league: EmailLeague | undefined = input.league;
    const refs = {
      templateKey,
      leagueId: league?.id,
      contestId: input.refs?.contestId,
      entryId: input.refs?.entryId,
      invitationId: input.refs?.invitationId,
    };
    const address = input.to.email.trim();
    const from = this.senderFor(league);
    const recipient = {
      ...refs,
      recipientUserId: input.to.userId,
      recipientEmail: address,
      idempotencyKey: `${idempotencyKeyPrefix(templateKey, input.about)}${input.to.userId ?? address.toLowerCase()}`,
      fromName: from.name,
      fromAddress: from.address,
    };
    const skipped = switchedOffReason(config, templateKey)
      ?? (this.inPlan(templateKey, league) ? undefined : EmailSkipReason.NOT_IN_PLAN)
      ?? (this.mayReceive(address, config) ? undefined : EmailSkipReason.NOT_ALLOWED_IN_ENVIRONMENT)
      ?? (await this.options.suppressions.findByEmail(address) ? EmailSkipReason.SUPPRESSED : undefined)
      ?? (await this.optedOut(templateKey, input.to.userId) ? EmailSkipReason.OPTED_OUT : undefined);
    if (skipped) {
      const { message, created } = await this.options.messages.record({
        ...recipient,
        status: EmailMessageStatus.SKIPPED,
        skipReason: skipped,
      });
      if (created) {
        this.options.logger?.info({
          action: 'email.send.skip',
          data: { reason: skipped, ...logRefs(refs) },
        }, SKIP_LOG_MESSAGES[skipped]);
      }
      return message;
    }

    const unsubscribe = this.unsubscribeLinks(templateKey, input.to.userId);
    const content = renderSystemEmailTemplate(templateKey, input.data, {
      timeZone: this.resolveTimeZone(input.to.timeZone, refs),
      locale: this.resolveLocale(input.to.locale, refs),
      hour12: input.to.timeFormat ? input.to.timeFormat === TimeFormat.TWELVE_HOUR : undefined,
      unsubscribeUrl: unsubscribe?.pageUrl,
    });
    const { message, created } = await this.options.messages.record({
      ...recipient,
      status: EmailMessageStatus.QUEUED,
      subject: content.subject,
      textBody: content.text,
      htmlBody: content.html,
      listUnsubscribeUrl: unsubscribe?.oneClickUrl,
      dueAt: this.options.now?.() ?? new Date(),
    });
    if (created) {
      this.options.logger?.info({ action: 'email.send.queued', data: logRefs(refs) }, 'Queued email');
      this.options.onQueued?.();
    } else {
      // Debug: a scheduler sweep records a due email again on every pass until its time is past.
      this.options.logger?.debug({ action: 'email.send.duplicate', data: logRefs(refs) }, 'Email already recorded; not queued again');
    }
    return message;
  }

  /**
   * Whether an email of `templateKey` about `about` is already recorded for anyone in the contest,
   * sent or skipped. A clock-driven email whose moment stays due for a while asks it, to do the
   * work that goes with queueing it only once.
   */
  async hasRecordedForContest(templateKey: SystemEmailTemplateKey, contestId: string, about: string): Promise<boolean> {
    return this.options.messages.existsForContest({ contestId, templateKey, keyPrefix: idempotencyKeyPrefix(templateKey, about) });
  }

  /**
   * The leagues an email of `templateKey` about `about` is already recorded from, for anyone,
   * sent or skipped. An email every league sends about one subject, such as an event coming up,
   * asks it to tell each league once.
   */
  async leaguesRecorded(templateKey: SystemEmailTemplateKey, about: string): Promise<Set<string>> {
    return this.options.messages.findLeagueIdsRecorded({ templateKey, keyPrefix: idempotencyKeyPrefix(templateKey, about) });
  }

  /**
   * Whether the league's plan has the email's plan feature, checked as the email is recorded, so
   * a plan change applies to the next email. An email with no feature is always sent.
   */
  private inPlan(templateKey: SystemEmailTemplateKey, league: EmailLeague | undefined): boolean {
    const feature = EMAIL_TEMPLATES[templateKey].planFeature;
    if (feature === null || league === undefined) return true;
    return this.options.planEntitlements.forPlan(league.plan).features.has(feature);
  }

  /** Whether the recipient turned off the category this email sits in; only users can. */
  private async optedOut(templateKey: SystemEmailTemplateKey, userId: string | undefined): Promise<boolean> {
    const category = optionalCategoryOf(templateKey);
    return category !== undefined && userId !== undefined && this.options.optOuts.isOptedOut(userId, category);
  }

  /**
   * The links an email a member can turn off carries: the "Stop these emails" page in its footer,
   * and the one-click address for its List-Unsubscribe header (RFC 8058). None on the rest.
   */
  private unsubscribeLinks(
    templateKey: SystemEmailTemplateKey,
    userId: string | undefined,
  ): { pageUrl: string; oneClickUrl: string } | undefined {
    const category = optionalCategoryOf(templateKey);
    if (category === undefined || userId === undefined) return undefined;
    const token = encodeURIComponent(this.options.unsubscribe.tokens.issue({ userId, category }));
    const base = this.options.unsubscribe.appBaseUrl;
    return {
      pageUrl: `${base}${UNSUBSCRIBE_PAGE_PATH}?token=${token}`,
      oneClickUrl: `${base}${ONE_CLICK_UNSUBSCRIBE_PATH}?token=${token}`,
    };
  }

  /** Where each invitation's latest invite email stands, by invitation id. */
  latestInviteStateByInvitation(invitationIds: string[]): Promise<Map<string, EmailMessageState>> {
    return this.options.messages.findLatestStateByInvitations(invitationIds, EmailTemplateKey.LEAGUE_MEMBER_INVITE);
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
   * The recipient's time zone, or US Eastern when they have none. A stored zone the runtime
   * doesn't know (saved before signup and preferences checked zones) is logged and shown as US
   * Eastern rather than failing the email.
   */
  private resolveTimeZone(timeZone: string | null | undefined, metadata: Parameters<typeof logRefs>[0]): string {
    if (!timeZone) return DEFAULT_DISPLAY_TIME_ZONE;
    if (isKnownTimeZone(timeZone)) return timeZone;
    this.options.logger?.warn({
      action: 'email.send.unknownTimeZone',
      data: { timeZone, ...logRefs(metadata) },
    }, 'Recipient time zone is unknown; showing dates in US Eastern');
    return DEFAULT_DISPLAY_TIME_ZONE;
  }

  /**
   * The recipient's locale, or en-US when they have none. A stored locale that isn't a language
   * tag is logged and shown as en-US rather than failing the email.
   */
  private resolveLocale(locale: string | null | undefined, metadata: Parameters<typeof logRefs>[0]): string {
    if (!locale) return DEFAULT_DISPLAY_LOCALE;
    if (isKnownLocale(locale)) return locale;
    this.options.logger?.warn({
      action: 'email.send.unknownLocale',
      data: { locale, ...logRefs(metadata) },
    }, 'Recipient locale is unknown; writing dates in en-US');
    return DEFAULT_DISPLAY_LOCALE;
  }

  /**
   * Reserved domains are refused only by SES, which delivers to the internet; Mailpit and the
   * test SMTP sink catch every address. The allow list applies on every transport.
   */
  private mayReceive(address: string, config: EmailConfig): boolean {
    const normalized = address.toLowerCase();
    if (this.options.providerName === 'ses' && isReservedDomain(domainOf(normalized))) {
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

function optionalCategoryOf(templateKey: SystemEmailTemplateKey): OptionalEmailCategory | undefined {
  const category = EMAIL_TEMPLATES[templateKey].category;
  return isOptionalEmailCategory(category) ? category : undefined;
}

/** What every idempotency key of one email about one subject starts with; the recipient follows. */
function idempotencyKeyPrefix(templateKey: SystemEmailTemplateKey, about: string): string {
  return `${templateKey}:${about}:`;
}
