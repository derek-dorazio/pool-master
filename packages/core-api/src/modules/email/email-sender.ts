/**
 * The email outbox's sender (#844): claims due emails and hands each to the transport, no faster
 * than EMAIL_CONFIG's rate. It runs in every core-api task; the claim skips rows another task
 * holds, so two tasks never send the same email. A queued email wakes it, and a timer catches
 * retries and anything a wake missed.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { EmailConfig } from '@poolmaster/shared/dto';
import type { EmailMessageRepository } from '@poolmaster/shared/db';
import type { EmailMessage } from '@poolmaster/shared/domain';
import { MailDeliveryThrottledError, type MailDeliveryProvider } from './mail-delivery';
import { EMAIL_TEMPLATES } from './system-email-templates';

/** How long after each failed try the next one is due: 1, 5 and 30 minutes, then FAILED. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** A claim lapses after this, so an email a stopped task held is sent by another. */
const CLAIM_MS = 5 * 60_000;
/** A throttled email is tried again this soon, without counting the try. */
const THROTTLED_DELAY_MS = 10_000;
const TICK_MS = 15_000;
const SECOND_MS = 1000;
/** Subjects and bodies are cleared this long after an email is created; the row stays. */
const CONTENT_KEPT_MS = 30 * 24 * 60 * 60_000;
const CONTENT_SWEEP_EVERY_MS = 60 * 60_000;

export interface EmailSenderOptions {
  messages: Pick<
    EmailMessageRepository,
    'claimDue' | 'markSent' | 'markRetry' | 'markThrottled' | 'markFailed' | 'clearContentCreatedBefore'
  >;
  transport: MailDeliveryProvider;
  readConfig: () => EmailConfig;
  logger?: FastifyBaseLogger;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export class EmailSender {
  private timer?: ReturnType<typeof setInterval>;
  private draining?: Promise<void>;
  /** Counts wakes, so a drain can tell whether one came while it was sending. */
  private wakes = 0;
  private lastContentSweepAt?: number;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: EmailSenderOptions) {
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms); }));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.drain(); }, TICK_MS);
    this.timer.unref();
    void this.drain();
    this.options.logger?.info({ action: 'email.sender.start' }, 'Email sender started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** An email was queued: send it now rather than at the next tick. */
  wake(): void {
    void this.drain();
  }

  /**
   * Sends every due email and resolves once none is left. A wake during a drain makes it look
   * again before it ends, so an email queued meanwhile is not left for the next tick. Never
   * rejects: a failure is logged and the next tick tries again.
   */
  drain(): Promise<void> {
    this.wakes++;
    if (this.draining) return this.draining;
    this.draining = this.run().finally(() => { this.draining = undefined; });
    return this.draining;
  }

  private async run(): Promise<void> {
    try {
      let wakesSeen: number;
      do {
        wakesSeen = this.wakes;
        await this.sendDue();
      } while (this.wakes !== wakesSeen);
      await this.clearOldContent();
    } catch (err) {
      this.options.logger?.error({
        action: 'email.sender.failure',
        data: { error: describeError(err) },
      }, 'Email sender pass failed; the next tick tries again');
    }
  }

  /** One batch of at most the configured rate a second, until a batch comes back short. */
  private async sendDue(): Promise<void> {
    for (;;) {
      const rate = this.options.readConfig().sendRatePerSecond;
      const startedAt = this.now().getTime();
      const batch = await this.options.messages.claimDue(new Date(startedAt), rate, new Date(startedAt + CLAIM_MS));
      await Promise.all(batch.map((message) => this.sendOne(message)));
      if (batch.length < rate) return;
      const elapsed = this.now().getTime() - startedAt;
      if (elapsed < SECOND_MS) await this.sleep(SECOND_MS - elapsed);
    }
  }

  private async sendOne(message: EmailMessage): Promise<void> {
    const refs = logRefs(message);
    try {
      if (message.attempts > MAX_ATTEMPTS) {
        // Only a claim that lapsed again and again gets here: each task holding it stopped mid-send.
        await this.options.messages.markFailed(message.id, {
          error: 'Gave up: every claim on this email lapsed',
          clearContent: carriesSecret(message),
        });
        this.options.logger?.error({ action: 'email.sender.abandoned', data: refs }, 'Gave up on an email whose claims kept lapsing');
        return;
      }
      if (message.subject === undefined || message.textBody === undefined || message.htmlBody === undefined) {
        await this.options.messages.markFailed(message.id, {
          error: 'Content was cleared before it was sent',
          clearContent: false,
        });
        this.options.logger?.error({ action: 'email.sender.noContent', data: refs }, 'Email content was cleared before it was sent');
        return;
      }
      const result = await this.options.transport.send({
        from: { name: message.fromName, address: message.fromAddress },
        to: message.recipientEmail,
        subject: message.subject,
        text: message.textBody,
        html: message.htmlBody,
        metadata: {
          templateKey: message.templateKey,
          leagueId: message.leagueId,
          contestId: message.contestId,
          entryId: message.entryId,
          invitationId: message.invitationId,
        },
      });
      await this.options.messages.markSent(message.id, {
        providerMessageId: result.messageId,
        sentAt: this.now(),
        clearContent: carriesSecret(message),
      });
      this.options.logger?.info({
        action: 'email.sender.sent',
        data: { ...refs, attempts: message.attempts },
      }, 'Sent email');
    } catch (err) {
      await this.recordFailure(message, err);
    }
  }

  private async recordFailure(message: EmailMessage, err: unknown): Promise<void> {
    const refs = logRefs(message);
    const error = describeError(err);
    const now = this.now().getTime();
    try {
      if (err instanceof MailDeliveryThrottledError) {
        await this.options.messages.markThrottled(message.id, new Date(now + THROTTLED_DELAY_MS));
        this.options.logger?.warn({ action: 'email.sender.throttled', data: refs }, 'Email transport throttled; trying again shortly');
        return;
      }
      if (message.attempts <= RETRY_DELAYS_MS.length) {
        const retryDelay = RETRY_DELAYS_MS[message.attempts - 1];
        await this.options.messages.markRetry(message.id, { nextAttemptAt: new Date(now + retryDelay), error });
        this.options.logger?.warn({
          action: 'email.sender.retry',
          data: { ...refs, attempts: message.attempts, retryInMs: retryDelay, error },
        }, 'Email send failed; it will be tried again');
        return;
      }
      await this.options.messages.markFailed(message.id, { error, clearContent: carriesSecret(message) });
      this.options.logger?.error({
        action: 'email.sender.failed',
        data: { ...refs, attempts: message.attempts, error },
      }, 'Email send failed on its last try; it will not be sent');
    } catch (recordErr) {
      // The claim lapses and the email is tried again.
      this.options.logger?.error({
        action: 'email.sender.recordFailure',
        data: { ...refs, error, recordError: describeError(recordErr) },
      }, 'Could not record an email send failure');
    }
  }

  private async clearOldContent(): Promise<void> {
    const now = this.now().getTime();
    if (this.lastContentSweepAt !== undefined && now - this.lastContentSweepAt < CONTENT_SWEEP_EVERY_MS) return;
    this.lastContentSweepAt = now;
    const cleared = await this.options.messages.clearContentCreatedBefore(new Date(now - CONTENT_KEPT_MS));
    if (cleared > 0) {
      this.options.logger?.info({ action: 'email.sender.contentCleared', data: { cleared } }, 'Cleared the content of old emails');
    }
  }
}

/** Ids only: never the address or the content. */
/** An email whose content is a secret (a reset link) keeps no copy once it is sent or given up on. */
function carriesSecret(message: EmailMessage): boolean {
  return !EMAIL_TEMPLATES[message.templateKey].keepsContent;
}

function logRefs(message: EmailMessage) {
  return {
    emailMessageId: message.id,
    templateKey: message.templateKey,
    leagueId: message.leagueId ?? null,
    contestId: message.contestId ?? null,
    entryId: message.entryId ?? null,
    invitationId: message.invitationId ?? null,
  };
}

/** The error and what caused it: a transport error's own message is generic. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? `: ${err.cause.message}` : '';
  return `${err.message}${cause}`;
}
