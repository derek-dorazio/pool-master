import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandOutput,
} from '@aws-sdk/client-sesv2';
import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { FastifyBaseLogger } from 'fastify';
import type { SystemEmailTemplateKey } from './system-email-templates';

export type MailDeliveryProviderName = 'smtp' | 'ses';

/** A sender: a display name and an address at the environment's sending domain. */
export interface MailAddress {
  name: string;
  address: string;
}

/** One rendered email to one person. There is no Reply-To: replies to the sender bounce. */
export interface MailDeliveryMessage {
  from: MailAddress;
  to: string;
  subject: string;
  text: string;
  html: string;
  metadata: {
    templateKey: SystemEmailTemplateKey;
    leagueId?: string;
    contestId?: string;
    entryId?: string;
    invitationId?: string;
  };
}

/** Why an email was not submitted to the transport. */
export const EmailSkipReason = {
  /** EMAIL_CONFIG has system email switched off. */
  EMAIL_DISABLED: 'EMAIL_DISABLED',
  /** EMAIL_CONFIG has this template switched off. */
  TEMPLATE_DISABLED: 'TEMPLATE_DISABLED',
  /** No recipient may be emailed here: a reserved domain on a real transport, or not on the allow list. */
  NOT_ALLOWED_IN_ENVIRONMENT: 'NOT_ALLOWED_IN_ENVIRONMENT',
} as const;
export type EmailSkipReason = (typeof EmailSkipReason)[keyof typeof EmailSkipReason];

export interface MailDeliveryResult {
  provider: MailDeliveryProviderName;
  messageId?: string;
  /** Set when nothing was submitted, with the reason. */
  skipped?: EmailSkipReason;
}

export interface MailDeliveryProvider {
  readonly providerName: MailDeliveryProviderName;
  send(message: MailDeliveryMessage): Promise<MailDeliveryResult>;
}

export interface MailDeliveryConfig {
  provider: MailDeliveryProviderName;
  /** The environment's `noreply@` address; its domain is the sending domain. */
  fromEmail: string;
  smtp?: SmtpMailDeliveryConfig;
  ses?: SesMailDeliveryConfig;
}

export interface SmtpMailDeliveryConfig {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
}

export interface SesMailDeliveryConfig {
  region: string;
  endpoint?: string;
  configurationSetName?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface SesClientLike {
  send(command: SendEmailCommand): Promise<SendEmailCommandOutput>;
}

export class MailDeliveryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailDeliveryConfigError';
  }
}

export class MailDeliveryError extends Error {
  constructor(
    message: string,
    readonly provider: MailDeliveryProviderName,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

/**
 * The From header value. A display name that is not plain ASCII is RFC 2047 encoded, since SES
 * takes the header as given, in words of ten characters so none passes the 75-character limit;
 * a quoted ASCII name escapes its quotes and backslashes.
 */
export function formatMailAddress(from: MailAddress): string {
  if (/^[\x20-\x7e]*$/.test(from.name)) {
    return `"${from.name.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}" <${from.address}>`;
  }
  const characters = Array.from(from.name);
  const words: string[] = [];
  for (let start = 0; start < characters.length; start += ENCODED_WORD_CHARACTERS) {
    const chunk = characters.slice(start, start + ENCODED_WORD_CHARACTERS).join('');
    words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`);
  }
  return `${words.join(' ')} <${from.address}>`;
}

/** At most 4 UTF-8 bytes each: 40 bytes is 56 base64 characters, plus 12 for the markers. */
const ENCODED_WORD_CHARACTERS = 10;

export class SmtpMailDeliveryProvider implements MailDeliveryProvider {
  readonly providerName = 'smtp' as const;

  private readonly transport: Transporter<SMTPTransport.SentMessageInfo>;

  constructor(
    config: MailDeliveryConfig,
    transport?: Transporter<SMTPTransport.SentMessageInfo>,
    private readonly logger?: FastifyBaseLogger,
  ) {
    if (!config.smtp) {
      throw new MailDeliveryConfigError('SMTP mail provider requires smtp configuration.');
    }
    this.transport = transport ?? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.username && config.smtp.password
        ? { user: config.smtp.username, pass: config.smtp.password }
        : undefined,
    });
  }

  async send(message: MailDeliveryMessage): Promise<MailDeliveryResult> {
    const recipients = [message.to];
    this.logger?.debug({
      action: 'mailDelivery.smtp.send.enter',
      data: {
        toCount: recipients.length,
        templateKey: message.metadata.templateKey,
        leagueId: message.metadata.leagueId ?? null,
        contestId: message.metadata.contestId ?? null,
        entryId: message.metadata.entryId ?? null,
        invitationId: message.metadata.invitationId ?? null,
      },
    }, 'Submitting SMTP email');
    try {
      const result = await this.transport.sendMail({
        from: message.from,
        to: recipients,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      const messageId = typeof result.messageId === 'string' ? result.messageId : undefined;
      this.logger?.info({
        action: 'mailDelivery.smtp.send.success',
        data: {
          toCount: recipients.length,
          messageId: messageId ?? null,
          templateKey: message.metadata.templateKey,
          leagueId: message.metadata.leagueId ?? null,
          contestId: message.metadata.contestId ?? null,
          entryId: message.metadata.entryId ?? null,
          invitationId: message.metadata.invitationId ?? null,
        },
      }, 'Submitted SMTP email');
      return { provider: this.providerName, messageId };
    } catch (err) {
      this.logger?.error({
        action: 'mailDelivery.smtp.send.failure',
        data: {
          toCount: recipients.length,
          templateKey: message.metadata.templateKey,
          leagueId: message.metadata.leagueId ?? null,
          contestId: message.metadata.contestId ?? null,
          entryId: message.metadata.entryId ?? null,
          invitationId: message.metadata.invitationId ?? null,
          error: err instanceof Error ? err.message : String(err),
        },
      }, 'SMTP email submission failed');
      throw new MailDeliveryError('SMTP email submission failed', this.providerName, err);
    }
  }
}

export class SesMailDeliveryProvider implements MailDeliveryProvider {
  readonly providerName = 'ses' as const;

  private readonly client: SesClientLike;

  constructor(
    private readonly config: MailDeliveryConfig,
    client?: SesClientLike,
    private readonly logger?: FastifyBaseLogger,
  ) {
    if (!config.ses) {
      throw new MailDeliveryConfigError('SES mail provider requires ses configuration.');
    }
    this.client = client ?? new SESv2Client({
      region: config.ses.region,
      endpoint: config.ses.endpoint,
      credentials: config.ses.accessKeyId && config.ses.secretAccessKey
        ? {
            accessKeyId: config.ses.accessKeyId,
            secretAccessKey: config.ses.secretAccessKey,
          }
        : undefined,
    });
  }

  async send(message: MailDeliveryMessage): Promise<MailDeliveryResult> {
    const recipients = [message.to];
    const configurationSetName = this.config.ses?.configurationSetName;
    this.logger?.debug({
      action: 'mailDelivery.ses.send.enter',
      data: {
        toCount: recipients.length,
        templateKey: message.metadata.templateKey,
        leagueId: message.metadata.leagueId ?? null,
        contestId: message.metadata.contestId ?? null,
        entryId: message.metadata.entryId ?? null,
        invitationId: message.metadata.invitationId ?? null,
      },
    }, 'Submitting SES email');
    try {
      const command = new SendEmailCommand({
        FromEmailAddress: formatMailAddress(message.from),
        Destination: { ToAddresses: recipients },
        ConfigurationSetName: configurationSetName || undefined,
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: message.text, Charset: 'UTF-8' },
              Html: { Data: message.html, Charset: 'UTF-8' },
            },
          },
        },
      });
      const result = await this.client.send(command);
      this.logger?.info({
        action: 'mailDelivery.ses.send.success',
        data: {
          toCount: recipients.length,
          messageId: result.MessageId ?? null,
          templateKey: message.metadata.templateKey,
          leagueId: message.metadata.leagueId ?? null,
          contestId: message.metadata.contestId ?? null,
          entryId: message.metadata.entryId ?? null,
          invitationId: message.metadata.invitationId ?? null,
        },
      }, 'Submitted SES email');
      return { provider: this.providerName, messageId: result.MessageId };
    } catch (err) {
      this.logger?.error({
        action: 'mailDelivery.ses.send.failure',
        data: {
          toCount: recipients.length,
          templateKey: message.metadata.templateKey,
          leagueId: message.metadata.leagueId ?? null,
          contestId: message.metadata.contestId ?? null,
          entryId: message.metadata.entryId ?? null,
          invitationId: message.metadata.invitationId ?? null,
          error: err instanceof Error ? err.message : String(err),
        },
      }, 'SES email submission failed');
      throw new MailDeliveryError('SES email submission failed', this.providerName, err);
    }
  }
}

export function readMailDeliveryConfig(
  env: NodeJS.ProcessEnv = process.env,
): MailDeliveryConfig {
  const provider = parseProviderName(env.EMAIL_PROVIDER ?? 'smtp');
  const fromEmail = provider === 'ses'
    ? env.SES_FROM_EMAIL ?? env.SMTP_FROM ?? 'noreply@poolmaster.local'
    : env.SMTP_FROM ?? env.SES_FROM_EMAIL ?? 'noreply@poolmaster.local';

  if (provider === 'smtp') {
    return {
      provider,
      fromEmail,
      smtp: {
        host: env.SMTP_HOST ?? 'localhost',
        port: parsePort(env.SMTP_PORT, 1025),
        secure: parseBoolean(env.SMTP_SECURE),
        username: env.SMTP_USERNAME?.trim() || undefined,
        password: env.SMTP_PASSWORD?.trim() || undefined,
      },
    };
  }

  return {
    provider,
    fromEmail,
    ses: {
      region: env.AWS_REGION ?? 'us-east-1',
      endpoint: env.AWS_ENDPOINT?.trim() || undefined,
      configurationSetName: env.SES_CONFIGURATION_SET?.trim() || undefined,
      accessKeyId: env.AWS_ACCESS_KEY_ID?.trim() || undefined,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY?.trim() || undefined,
    },
  };
}

export function createMailDeliveryProvider(
  config: MailDeliveryConfig = readMailDeliveryConfig(),
  logger?: FastifyBaseLogger,
): MailDeliveryProvider {
  if (config.provider === 'smtp') {
    return new SmtpMailDeliveryProvider(config, undefined, logger);
  }
  return new SesMailDeliveryProvider(config, undefined, logger);
}

export function readApplicationBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.APP_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
}

function parseProviderName(value: string): MailDeliveryProviderName {
  const provider = value.trim().toLowerCase();
  if (provider === 'smtp' || provider === 'ses') return provider;
  throw new MailDeliveryConfigError(`Unsupported EMAIL_PROVIDER: ${value}`);
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new MailDeliveryConfigError(`Invalid SMTP_PORT: ${value}`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}
