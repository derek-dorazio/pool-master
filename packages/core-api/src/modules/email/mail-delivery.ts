import {
  SESClient,
  SendEmailCommand,
  type SendEmailCommandOutput,
} from '@aws-sdk/client-ses';
import nodemailer, { type Transporter } from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';

export type MailDeliveryProviderName = 'smtp' | 'ses';

export interface MailDeliveryMessage {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  metadata?: {
    templateKey?: string;
    leagueId?: string;
    contestId?: string;
    entryId?: string;
    invitationId?: string;
  };
}

export interface MailDeliveryResult {
  provider: MailDeliveryProviderName;
  messageId?: string;
}

export interface MailDeliveryProvider {
  readonly providerName: MailDeliveryProviderName;
  send(message: MailDeliveryMessage): Promise<MailDeliveryResult>;
}

export interface MailDeliveryConfig {
  provider: MailDeliveryProviderName;
  fromEmail: string;
  replyToEmail?: string;
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
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

export class SmtpMailDeliveryProvider implements MailDeliveryProvider {
  readonly providerName = 'smtp' as const;

  private readonly transport: Transporter;

  constructor(
    private readonly config: MailDeliveryConfig,
    transport?: Transporter,
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
    const recipients = normalizeRecipients(message.to);
    this.logger?.debug({
      action: 'mailDelivery.smtp.send.enter',
      data: {
        toCount: recipients.length,
        templateKey: message.metadata?.templateKey ?? null,
        leagueId: message.metadata?.leagueId ?? null,
        contestId: message.metadata?.contestId ?? null,
        entryId: message.metadata?.entryId ?? null,
        invitationId: message.metadata?.invitationId ?? null,
      },
    }, 'Submitting SMTP email');
    try {
      const result = await this.transport.sendMail({
        from: this.config.fromEmail,
        to: recipients,
        replyTo: message.replyTo ?? this.config.replyToEmail,
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
          templateKey: message.metadata?.templateKey ?? null,
          leagueId: message.metadata?.leagueId ?? null,
          contestId: message.metadata?.contestId ?? null,
          entryId: message.metadata?.entryId ?? null,
          invitationId: message.metadata?.invitationId ?? null,
        },
      }, 'Submitted SMTP email');
      return { provider: this.providerName, messageId };
    } catch (err) {
      this.logger?.error({
        action: 'mailDelivery.smtp.send.failure',
        data: {
          toCount: recipients.length,
          templateKey: message.metadata?.templateKey ?? null,
          leagueId: message.metadata?.leagueId ?? null,
          contestId: message.metadata?.contestId ?? null,
          entryId: message.metadata?.entryId ?? null,
          invitationId: message.metadata?.invitationId ?? null,
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
    this.client = client ?? new SESClient({
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
    const recipients = normalizeRecipients(message.to);
    const configurationSetName = this.config.ses?.configurationSetName;
    this.logger?.debug({
      action: 'mailDelivery.ses.send.enter',
      data: {
        toCount: recipients.length,
        templateKey: message.metadata?.templateKey ?? null,
        leagueId: message.metadata?.leagueId ?? null,
        contestId: message.metadata?.contestId ?? null,
        entryId: message.metadata?.entryId ?? null,
        invitationId: message.metadata?.invitationId ?? null,
      },
    }, 'Submitting SES email');
    try {
      const replyTo = message.replyTo ?? this.config.replyToEmail;
      const command = new SendEmailCommand({
        Source: this.config.fromEmail,
        Destination: { ToAddresses: recipients },
        ReplyToAddresses: replyTo ? [replyTo] : undefined,
        ConfigurationSetName: configurationSetName || undefined,
        Message: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: message.text, Charset: 'UTF-8' },
            Html: { Data: message.html, Charset: 'UTF-8' },
          },
        },
      });
      const result = await this.client.send(command);
      this.logger?.info({
        action: 'mailDelivery.ses.send.success',
        data: {
          toCount: recipients.length,
          messageId: result.MessageId ?? null,
          templateKey: message.metadata?.templateKey ?? null,
          leagueId: message.metadata?.leagueId ?? null,
          contestId: message.metadata?.contestId ?? null,
          entryId: message.metadata?.entryId ?? null,
          invitationId: message.metadata?.invitationId ?? null,
        },
      }, 'Submitted SES email');
      return { provider: this.providerName, messageId: result.MessageId };
    } catch (err) {
      this.logger?.error({
        action: 'mailDelivery.ses.send.failure',
        data: {
          toCount: recipients.length,
          templateKey: message.metadata?.templateKey ?? null,
          leagueId: message.metadata?.leagueId ?? null,
          contestId: message.metadata?.contestId ?? null,
          entryId: message.metadata?.entryId ?? null,
          invitationId: message.metadata?.invitationId ?? null,
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
  const replyToEmail = env.EMAIL_REPLY_TO?.trim() || undefined;

  if (provider === 'smtp') {
    return {
      provider,
      fromEmail,
      replyToEmail,
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
    replyToEmail,
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

function normalizeRecipients(to: string | string[]): string[] {
  const recipients = Array.isArray(to) ? to : [to];
  return recipients.map((recipient) => recipient.trim()).filter(Boolean);
}
