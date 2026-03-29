/**
 * EmailChannel — sends transactional emails via SMTP (Mailpit in dev) or SES.
 *
 * Two providers:
 * - SmtpEmailProvider: uses nodemailer, sends to any SMTP server (Mailpit locally)
 * - SesEmailProvider: uses @aws-sdk/client-ses (LocalStack locally, real SES in prod)
 */

import { createTransport, type Transporter } from 'nodemailer';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

// --- Provider Interface ---

export interface EmailDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailProvider {
  send(params: {
    to: string;
    from: string;
    subject: string;
    html?: string;
    text: string;
  }): Promise<EmailDeliveryResult>;
}

// --- SMTP Provider (Mailpit in dev) ---

export class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: Transporter;

  constructor(config: { host: string; port: number }) {
    this.transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      tls: { rejectUnauthorized: false },
    });
  }

  async send(params: {
    to: string;
    from: string;
    subject: string;
    html?: string;
    text: string;
  }): Promise<EmailDeliveryResult> {
    try {
      const info = await this.transporter.sendMail({
        from: params.from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      });
      return { success: true, messageId: info.messageId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// --- SES Provider (LocalStack in dev, real SES in prod) ---

export class SesEmailProvider implements EmailProvider {
  private readonly client: SESClient;

  constructor(config: { endpoint?: string; region: string }) {
    this.client = new SESClient({
      region: config.region,
      ...(config.endpoint && {
        endpoint: config.endpoint,
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      }),
    });
  }

  async send(params: {
    to: string;
    from: string;
    subject: string;
    html?: string;
    text: string;
  }): Promise<EmailDeliveryResult> {
    try {
      const result = await this.client.send(
        new SendEmailCommand({
          Source: params.from,
          Destination: { ToAddresses: [params.to] },
          Message: {
            Subject: { Data: params.subject },
            Body: {
              Text: { Data: params.text },
              ...(params.html && { Html: { Data: params.html } }),
            },
          },
        }),
      );
      return { success: true, messageId: result.MessageId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// --- EmailChannel (orchestrates provider + user lookup) ---

export class EmailChannel {
  constructor(
    private readonly provider: EmailProvider,
    private readonly fromAddress: string,
  ) {}

  async sendToUser(
    userEmail: string,
    subject: string,
    text: string,
    html?: string,
  ): Promise<EmailDeliveryResult> {
    return this.provider.send({
      to: userEmail,
      from: this.fromAddress,
      subject,
      text,
      html,
    });
  }
}
