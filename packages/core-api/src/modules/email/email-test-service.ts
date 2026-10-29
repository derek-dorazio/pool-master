/**
 * The root admin's test email (#910): one fixed email to one address, recorded and sent like any
 * other, so the overall switch, "Only send to", the suppression list and the provider are all
 * exercised. It wakes the sender and waits a few seconds for this email's first try, so the Email
 * settings can show what happened; it never waits for the rest of the queue.
 */
import type { EmailMessageRepository, UserRepository } from '@poolmaster/shared/db';
import { EmailMessageStatus, EmailTemplateKey, type EmailMessage } from '@poolmaster/shared/domain';
import { formatUserName } from './email-content';
import type { EmailSender } from './email-sender';
import type { EmailService } from './email-service';

/** How long the request waits for the test email's first try, well inside the load balancer's idle timeout. */
const SETTLE_POLLS = 32;
const POLL_MS = 250;

export interface EmailTestServiceOptions {
  email: Pick<EmailService, 'send'>;
  sender: Pick<EmailSender, 'wake'>;
  messages: Pick<EmailMessageRepository, 'findById'>;
  users: Pick<UserRepository, 'findById'>;
  /** POOLMASTER_ENVIRONMENT, named in the email. */
  environment: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

/** Not yet tried: queued with no attempt, or claimed by a sender (this task's or another's). */
function awaitingFirstTry(message: EmailMessage): boolean {
  return message.status === EmailMessageStatus.SENDING
    || (message.status === EmailMessageStatus.QUEUED && message.attempts === 0);
}

export class EmailTestService {
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: EmailTestServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms); }));
  }

  /**
   * Sends the test email for root admin `requestedByUserId` and returns it once its first try is
   * done, or as it stands after about eight seconds (SENDING or QUEUED) if no try finished by then.
   */
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
    this.options.sender.wake();
    let current = message;
    for (let poll = 0; poll < SETTLE_POLLS && awaitingFirstTry(current); poll++) {
      await this.sleep(POLL_MS);
      // poolmaster-allow-query-in-loop: bounded by SETTLE_POLLS, one test email
      current = await this.options.messages.findById(message.id) ?? current;
    }
    return current;
  }
}
