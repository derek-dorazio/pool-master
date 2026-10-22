/**
 * Port for the email outbox (#844): one row per system email per recipient, queued and then
 * sent by the sender loop, or skipped with the reason.
 */

import type { EmailMessage, EmailMessageStatus, EmailSkipReason, EmailTemplateKey } from '../domain';

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
   * claimed ones whose claim lapsed (a sender stopped mid-send). Each becomes SENDING with one
   * more attempt and is held until `claimUntil`. Rows another sender holds are passed over.
   */
  claimDue(now: Date, limit: number, claimUntil: Date): Promise<EmailMessage[]>;
  /** SENT. `clearContent` also clears the subject and bodies at once (an email carrying a secret). */
  markSent(id: string, sent: { providerMessageId?: string; sentAt: Date; clearContent: boolean }): Promise<void>;
  /** Back to QUEUED, due at `nextAttemptAt`, keeping the error of the try that failed. */
  markRetry(id: string, retry: { nextAttemptAt: Date; error: string }): Promise<void>;
  /** Back to QUEUED, due at `nextAttemptAt`, with the try not counted: the transport was busy. */
  markThrottled(id: string, nextAttemptAt: Date): Promise<void>;
  /** FAILED for good. `clearContent` as for `markSent`. */
  markFailed(id: string, failed: { error: string; clearContent: boolean }): Promise<void>;
  /** Clears the subject and bodies of emails created before `cutoff`; returns how many. */
  clearContentCreatedBefore(cutoff: Date): Promise<number>;
  /** The status of each invitation's latest email of `templateKey`, by invitation id. */
  findLatestStatusByInvitations(
    invitationIds: string[],
    templateKey: EmailTemplateKey,
  ): Promise<Map<string, EmailMessageStatus>>;
}
