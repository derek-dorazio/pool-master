/**
 * The root admin's test email (#910): one fixed email to one address, recorded and sent like any
 * other, so the overall switch, "Only send to", the suppression list and the provider are all
 * exercised. It waits for the sender's try, so the Email settings can show what happened.
 */
import type { EmailMessageRepository, UserRepository } from '@poolmaster/shared/db';
import { EmailMessageStatus, EmailTemplateKey, type EmailMessage } from '@poolmaster/shared/domain';
import { formatUserName } from './email-content';
import type { EmailSender } from './email-sender';
import type { EmailService } from './email-service';

export interface EmailTestServiceOptions {
  email: Pick<EmailService, 'send'>;
  sender: Pick<EmailSender, 'drain'>;
  messages: Pick<EmailMessageRepository, 'findById'>;
  users: Pick<UserRepository, 'findById'>;
  /** POOLMASTER_ENVIRONMENT, named in the email. */
  environment: string;
  now?: () => Date;
}

export class EmailTestService {
  private readonly now: () => Date;

  constructor(private readonly options: EmailTestServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** Sends the test email for root admin `requestedByUserId` and returns it as it stands after the sender's try. */
  async send(to: string, requestedByUserId: string): Promise<EmailMessage> {
    const requestedAt = this.now();
    const admin = await this.options.users.findById(requestedByUserId);
    const requestedBy = admin ? formatUserName(admin) : 'A root admin';
    const message = await this.options.email.send(EmailTemplateKey.EMAIL_TEST, {
      to: { email: to },
      // Each press is its own email: the outbox records an email once per template, about and recipient.
      about: requestedAt.toISOString(),
      data: { environment: this.options.environment, requestedBy, requestedAt },
    });
    if (message.status !== EmailMessageStatus.QUEUED) return message;
    await this.options.sender.drain();
    return await this.options.messages.findById(message.id) ?? message;
  }
}
