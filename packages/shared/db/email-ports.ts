/**
 * Port for the email outbox (#844): one row per system email per recipient, queued and then
 * sent by the sender loop, or skipped with the reason.
 */

import type {
  DeliveryOutcomeStatus,
  EmailMessage,
  EmailMessageStatus,
  EmailSkipReason,
  EmailSuppression,
  EmailSuppressionReason,
  EmailTemplateKey,
  OptionalEmailCategory,
} from '../domain';

/** Where one email stands: its status, and why it was skipped when it was. */
export type EmailMessageState = Pick<EmailMessage, 'status' | 'skipReason'>;

interface EmailMessageRecordBase {
  templateKey: EmailTemplateKey;
  recipientUserId?: string;
  recipientEmail: string;
  leagueId?: string;
  contestId?: string;
  entryId?: string;
  invitationId?: string;
  idempotencyKey: string;
  fromName: string;
  fromAddress: string;
}

/** An email to record: queued with its rendered content, due at once, or skipped with the reason. */
export type EmailMessageRecord =
  | (EmailMessageRecordBase & {
    status: typeof EmailMessageStatus.QUEUED;
    subject: string;
    textBody: string;
    htmlBody: string;
    listUnsubscribeUrl?: string;
    dueAt: Date;
  })
  | (EmailMessageRecordBase & {
    status: typeof EmailMessageStatus.SKIPPED;
    skipReason: EmailSkipReason;
  });

export interface EmailMessageRecordResult {
  message: EmailMessage;
  /** False when the idempotency key was already recorded: nothing was written. */
  created: boolean;
}

export interface EmailMessageRepository {
  /** Records one email, unless its idempotency key is already recorded; then returns that row. */
  record(input: EmailMessageRecord): Promise<EmailMessageRecordResult>;
  /**
   * Claims up to `limit` due emails, oldest due first: queued ones whose time has come, and
   * claimed ones whose claim lapsed (a sender stopped mid-send). Emails of `firstTemplateKeys`
   * come before the rest, so a time-critical email never waits behind a backlog. Each becomes
   * SENDING with one more attempt and is held until `claimUntil`. Rows another sender holds are
   * passed over.
   */
  claimDue(claim: {
    now: Date;
    limit: number;
    claimUntil: Date;
    firstTemplateKeys: readonly EmailTemplateKey[];
  }): Promise<EmailMessage[]>;
  /** SENT. `clearContent` also clears the subject and bodies at once (an email carrying a secret). */
  markSent(id: string, sent: { providerMessageId?: string; sentAt: Date; clearContent: boolean }): Promise<void>;
  /** Back to QUEUED, due at `nextAttemptAt`, keeping the error of the try that failed. */
  markRetry(id: string, retry: { nextAttemptAt: Date; error: string }): Promise<void>;
  /** Back to QUEUED, due at `nextAttemptAt`, with the try not counted: the transport was busy. */
  markThrottled(id: string, nextAttemptAt: Date): Promise<void>;
  /** FAILED for good. `clearContent` as for `markSent`. */
  markFailed(id: string, failed: { error: string; clearContent: boolean }): Promise<void>;
  /**
   * Records what SES reported about a sent email, found by its SES message id: DELIVERED from
   * SENT; BOUNCED or COMPLAINED from SENT or DELIVERED (a bounce or a complaint can follow a
   * delivery); FAILED, with `error`, from SENT when SES rejected it. A report that would move the
   * email backwards, or repeats, changes nothing. Returns the email, or undefined for an id the
   * outbox never sent (another environment's, or a test send from the console).
   */
  recordDeliveryOutcome(
    providerMessageId: string,
    outcome: { status: DeliveryOutcomeStatus; error?: string },
  ): Promise<EmailMessage | undefined>;
  /** Clears the subject and bodies of emails created before `cutoff`; returns how many. */
  clearContentCreatedBefore(cutoff: Date): Promise<number>;
  /**
   * Whether an email of `templateKey` about the contest is recorded under an idempotency key
   * starting with `keyPrefix`: for anyone, in any state.
   */
  existsForContest(query: { contestId: string; templateKey: EmailTemplateKey; keyPrefix: string }): Promise<boolean>;
  /**
   * The leagues an email of `templateKey` is recorded from under an idempotency key starting
   * with `keyPrefix`: for anyone, in any state.
   */
  findLeagueIdsRecorded(query: { templateKey: EmailTemplateKey; keyPrefix: string }): Promise<Set<string>>;
  /** Where each invitation's latest email of `templateKey` stands, by invitation id. */
  findLatestStateByInvitations(
    invitationIds: string[],
    templateKey: EmailTemplateKey,
  ): Promise<Map<string, EmailMessageState>>;
}

/** Addresses the app no longer emails (#844 slice 4): a permanent bounce or a complaint. */
export interface EmailSuppressionRepository {
  /** Adds the address (lower-cased) unless it is already there; the first reason stands. */
  suppress(input: { email: string; suppressionReason: EmailSuppressionReason; emailMessageId?: string }): Promise<void>;
  /** The address's suppression, if it has one. */
  findByEmail(email: string): Promise<EmailSuppression | undefined>;
}

/** The categories of email each user turned off (#844 slice 5); a category not listed is on. */
export interface EmailOptOutRepository {
  findByUser(userId: string): Promise<OptionalEmailCategory[]>;
  isOptedOut(userId: string, category: OptionalEmailCategory): Promise<boolean>;
  /** Turns the category off (`optedOut` true) or back on; repeating either changes nothing. */
  setOptedOut(userId: string, category: OptionalEmailCategory, optedOut: boolean): Promise<void>;
}
