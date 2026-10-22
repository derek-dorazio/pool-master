/**
 * An in-memory EmailMessageRepository (#844), for service and sender tests that assert what the
 * outbox holds rather than which repository calls were made. The Prisma adapter behind the same
 * port is tested against Postgres in email-outbox.integration.
 */

import type {
  EmailMessageRecord,
  EmailMessageRecordResult,
  EmailMessageRepository,
} from '@poolmaster/shared/db';
import {
  EmailMessageStatus,
  type EmailMessage,
  type EmailTemplateKey,
} from '@poolmaster/shared/domain';

const CLEARED_CONTENT = { subject: undefined, textBody: undefined, htmlBody: undefined };

export interface InMemoryEmailMessages extends EmailMessageRepository {
  /** Every recorded email, in the order recorded. */
  rows: EmailMessage[];
}

export function inMemoryEmailMessages(now: () => Date = () => new Date()): InMemoryEmailMessages {
  const rows: EmailMessage[] = [];
  let nextId = 1;

  function update(id: string, changes: Partial<EmailMessage>): void {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`No email message ${id}`);
    Object.assign(row, changes, { updatedAt: now() });
  }

  return {
    rows,
    record(input: EmailMessageRecord): Promise<EmailMessageRecordResult> {
      const existing = rows.find((row) => row.idempotencyKey === input.idempotencyKey);
      if (existing) return Promise.resolve({ message: { ...existing }, created: false });
      const { dueAt, ...queued } = input.status === EmailMessageStatus.QUEUED
        ? input
        : { ...input, dueAt: undefined };
      const message: EmailMessage = {
        ...queued,
        id: `email-${String(nextId++)}`,
        createdAt: now(),
        updatedAt: now(),
        attempts: 0,
        nextAttemptAt: dueAt,
      };
      rows.push(message);
      return Promise.resolve({ message: { ...message }, created: true });
    },
    claimDue({ now: at, limit, claimUntil, firstTemplateKeys }): Promise<EmailMessage[]> {
      const isFirst = (row: EmailMessage) => (firstTemplateKeys.includes(row.templateKey) ? 0 : 1);
      const due = rows
        .filter((row) => (row.status === EmailMessageStatus.QUEUED || row.status === EmailMessageStatus.SENDING)
          && row.nextAttemptAt !== undefined && row.nextAttemptAt <= at)
        .sort((a, b) => isFirst(a) - isFirst(b)
          || (a.nextAttemptAt?.getTime() ?? 0) - (b.nextAttemptAt?.getTime() ?? 0))
        .slice(0, limit);
      for (const row of due) {
        update(row.id, { status: EmailMessageStatus.SENDING, attempts: row.attempts + 1, nextAttemptAt: claimUntil });
      }
      return Promise.resolve(due.map((row) => ({ ...row })));
    },
    markSent(id, sent) {
      update(id, {
        status: EmailMessageStatus.SENT,
        providerMessageId: sent.providerMessageId,
        sentAt: sent.sentAt,
        nextAttemptAt: undefined,
        ...(sent.clearContent ? CLEARED_CONTENT : {}),
      });
      return Promise.resolve();
    },
    markRetry(id, retry) {
      update(id, { status: EmailMessageStatus.QUEUED, nextAttemptAt: retry.nextAttemptAt, lastError: retry.error });
      return Promise.resolve();
    },
    markThrottled(id, nextAttemptAt) {
      const row = rows.find((candidate) => candidate.id === id);
      update(id, { status: EmailMessageStatus.QUEUED, nextAttemptAt, attempts: (row?.attempts ?? 1) - 1 });
      return Promise.resolve();
    },
    markFailed(id, failed) {
      update(id, {
        status: EmailMessageStatus.FAILED,
        nextAttemptAt: undefined,
        lastError: failed.error,
        ...(failed.clearContent ? CLEARED_CONTENT : {}),
      });
      return Promise.resolve();
    },
    clearContentCreatedBefore(cutoff) {
      const old = rows.filter((row) => row.createdAt < cutoff && row.subject !== undefined);
      for (const row of old) {
        update(row.id, CLEARED_CONTENT);
      }
      return Promise.resolve(old.length);
    },
    findLatestStatusByInvitations(invitationIds: string[], templateKey: EmailTemplateKey) {
      const latest = new Map<string, EmailMessageStatus>();
      for (const row of rows) {
        if (row.invitationId && invitationIds.includes(row.invitationId) && row.templateKey === templateKey) {
          latest.set(row.invitationId, row.status);
        }
      }
      return Promise.resolve(latest);
    },
  };
}
