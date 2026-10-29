/**
 * The email outbox's sender (#844): claims due emails and hands each to the transport, no faster
 * than EMAIL_CONFIG's rate. It runs in every core-api task; the claim skips rows another task
 * holds, so two tasks never send the same email. A queued email wakes it, and a timer catches
 * retries and anything a wake missed.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { EmailConfig } from '@poolmaster/shared/dto';
import type { EmailMessageRepository } from '@poolmaster/shared/db';
import type { EmailMessage, EmailTemplateKey } from '@poolmaster/shared/domain';
import { MailDeliveryThrottledError, type MailDeliveryProvider } from './mail-delivery';
import { EMAIL_TEMPLATES } from './system-email-templates';
import { outsideRequest } from '../../core/request-scope';

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
/**
 * Each hourly sweep clears the emails that crossed CONTENT_KEPT_MS in the last week, not every
 * email ever created before it (#1175): the ones older than the window were cleared by earlier
 * sweeps, and the window keeps the sweep on the `created_at` index. A week covers any outage.
 */
const CONTENT_SWEEP_WINDOW_MS = 7 * 24 * 60 * 60_000;

export interface EmailSenderOptions {
  messages: Pick<
    EmailMessageRepository,
    'claimDue' | 'markSent' | 'markRetry' | 'markThrottled' | 'markFailed' | 'clearContentCreatedBetween'
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
   *
   * A drain a request wakes runs outside that request: it is shared by every later wake, and
   * neither the request's read memo nor its query count is its own (#1244).
   */
  drain(): Promise<void> {
    this.wakes++;
    if (this.draining) return this.draining;
    this.draining = outsideRequest(() => this.run());
    return this.draining;
  }

  private async run(): Promise<void> {
    try {
      // The sweep goes first: a wake during it is then seen by the loop below, where after the
      // loop it would find this drain finishing and be lost until the next tick.
      await this.clearOldContent();
      let wakesSeen: number;
      do {
        wakesSeen = this.wakes;
        await this.sendDue();
      } while (this.wakes !== wakesSeen);
    } catch (err) {
      this.options.logger?.error({
        action: 'email.sender.failure',
        data: { error: describeError(err) },
      }, 'Email sender pass failed; the next tick tries again');
    } finally {
      // Cleared in the same step as the last wake check, so a later wake starts a new drain.
      this.draining = undefined;
    }
  }

  /** One batch of at most the configured rate a second, until a batch comes back short. */
  private async sendDue(): Promise<void> {
    for (;;) {
      const rate = this.options.readConfig().sendRatePerSecond;
      const startedAt = this.now().getTime();
      const batch = await this.options.messages.claimDue({
        now: new Date(startedAt),
        limit: rate,
        claimUntil: new Date(startedAt + CLAIM_MS),
        firstTemplateKeys: TIME_CRITICAL_TEMPLATE_KEYS,
      });
      await Promise.all(batch.map((message) => this.sendOne(message)));
      if (batch.length < rate) return;
      const elapsed = this.now().getTime() - startedAt;
      if (elapsed < SECOND_MS) await this.sleep(SECOND_MS - elapsed);
    }
  }

  private async sendOne(message: EmailMessage): Promise<void> {
    const refs = logRefs(message);
    try {
      if (this.isPastSendBy(message, this.now().getTime())) {
        await this.giveUpLate(message);
        return;
      }
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
        listUnsubscribeUrl: message.listUnsubscribeUrl,
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

  /** Whether `at` is past the time the email may still go out (its template's send-by window). */
  private isPastSendBy(message: EmailMessage, at: number): boolean {
    const sendWithinMs = EMAIL_TEMPLATES[message.templateKey].sendWithinMs;
    return sendWithinMs !== null && at > message.createdAt.getTime() + sendWithinMs;
  }

  /** FAILED, neither sent nor retried, once its send-by window has passed. */
  private async giveUpLate(message: EmailMessage): Promise<void> {
    await this.options.messages.markFailed(message.id, {
      error: 'Not sent within its send-by window',
      clearContent: carriesSecret(message),
    });
    this.options.logger?.warn({
      action: 'email.sender.expired',
      data: { ...logRefs(message), attempts: message.attempts },
    }, 'Gave up on an email past its send-by window');
  }

  private async recordFailure(message: EmailMessage, err: unknown): Promise<void> {
    const refs = logRefs(message);
    const error = describeError(err);
    const now = this.now().getTime();
    try {
      if (err instanceof MailDeliveryThrottledError) {
        if (this.isPastSendBy(message, now + THROTTLED_DELAY_MS)) {
          await this.giveUpLate(message);
          return;
        }
        await this.options.messages.markThrottled(message.id, new Date(now + THROTTLED_DELAY_MS));
        this.options.logger?.warn({ action: 'email.sender.throttled', data: refs }, 'Email transport throttled; trying again shortly');
        return;
      }
      if (message.attempts <= RETRY_DELAYS_MS.length) {
        const retryDelay = RETRY_DELAYS_MS[message.attempts - 1];
        if (this.isPastSendBy(message, now + retryDelay)) {
          await this.giveUpLate(message);
          return;
        }
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
    // A failed sweep is logged and left to the next hour; it never holds up this pass's sends.
    try {
      const before = now - CONTENT_KEPT_MS;
      const cleared = await this.options.messages.clearContentCreatedBetween(new Date(before - CONTENT_SWEEP_WINDOW_MS), new Date(before));
      if (cleared > 0) {
        this.options.logger?.info({ action: 'email.sender.contentCleared', data: { cleared } }, 'Cleared the content of old emails');
      }
    } catch (err) {
      this.options.logger?.error({
        action: 'email.sender.sweepFailure',
        data: { error: describeError(err) },
      }, 'Could not clear the content of old emails; the next sweep tries again');
    }
  }
}

/** Templates with a send-by window, claimed ahead of the rest so a backlog never holds them. */
const TIME_CRITICAL_TEMPLATE_KEYS: readonly EmailTemplateKey[] = (Object.keys(EMAIL_TEMPLATES) as EmailTemplateKey[])
  .filter((templateKey) => EMAIL_TEMPLATES[templateKey].sendWithinMs !== null);

/** An email whose content is a secret (a reset link) keeps no copy once it is sent or given up on. */
function carriesSecret(message: EmailMessage): boolean {
  return !EMAIL_TEMPLATES[message.templateKey].keepsContent;
}

/** Ids only: never the address or the content. */
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
