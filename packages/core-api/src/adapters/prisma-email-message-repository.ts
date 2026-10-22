/**
 * Prisma adapter for EmailMessageRepository — the email outbox (#844).
 */

import type { EmailMessage as EmailMessageRow, PrismaClient } from '@prisma/client';
import type {
  EmailMessageRecord,
  EmailMessageRecordResult,
  EmailMessageRepository,
  EmailMessageState,
} from '@poolmaster/shared/db';
import {
  DELIVERY_OUTCOME_FROM,
  EmailMessageStatus,
  type DeliveryOutcomeStatus,
  type EmailMessage,
  type EmailTemplateKey,
} from '@poolmaster/shared/domain';

const CLEARED_CONTENT = { subject: null, textBody: null, htmlBody: null, listUnsubscribeUrl: null };

export class PrismaEmailMessageRepository implements EmailMessageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: EmailMessageRecord): Promise<EmailMessageRecordResult> {
    const base = {
      templateKey: input.templateKey,
      recipientUserId: input.recipientUserId,
      recipientEmail: input.recipientEmail,
      leagueId: input.leagueId,
      contestId: input.contestId,
      entryId: input.entryId,
      invitationId: input.invitationId,
      idempotencyKey: input.idempotencyKey,
      fromName: input.fromName,
      fromAddress: input.fromAddress,
      status: input.status,
    };
    // ON CONFLICT DO NOTHING: a key already recorded writes nothing, and raises nothing that
    // would abort a surrounding transaction.
    const { count } = await this.prisma.emailMessage.createMany({
      data: input.status === EmailMessageStatus.QUEUED
        ? {
          ...base,
          subject: input.subject,
          textBody: input.textBody,
          htmlBody: input.htmlBody,
          listUnsubscribeUrl: input.listUnsubscribeUrl,
          nextAttemptAt: input.dueAt,
        }
        : { ...base, skipReason: input.skipReason },
      skipDuplicates: true,
    });
    const row = await this.prisma.emailMessage.findUniqueOrThrow({
      where: { idempotencyKey: input.idempotencyKey },
    });
    return { message: toEmailMessage(row), created: count === 1 };
  }

  async claimDue(claim: {
    now: Date;
    limit: number;
    claimUntil: Date;
    firstTemplateKeys: readonly EmailTemplateKey[];
  }): Promise<EmailMessage[]> {
    const { now, limit, claimUntil } = claim;
    const firstKeys = [...claim.firstTemplateKeys];
    return this.prisma.$transaction(async (tx) => {
      // SKIP LOCKED: two senders (prod runs two tasks) never claim the same row.
      const due = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "email_messages"
        WHERE "status" IN ('QUEUED', 'SENDING') AND "next_attempt_at" <= ${now}
        ORDER BY ("template_key"::text = ANY(${firstKeys}::text[])) DESC, "next_attempt_at"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`;
      if (due.length === 0) return [];
      const ids = due.map((row) => row.id);
      await tx.emailMessage.updateMany({
        where: { id: { in: ids } },
        data: {
          status: EmailMessageStatus.SENDING,
          attempts: { increment: 1 },
          nextAttemptAt: claimUntil,
        },
      });
      const rows = await tx.emailMessage.findMany({
        where: { id: { in: ids } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toEmailMessage);
    });
  }

  async markSent(id: string, sent: { providerMessageId?: string; sentAt: Date; clearContent: boolean }): Promise<void> {
    await this.prisma.emailMessage.update({
      where: { id },
      data: {
        status: EmailMessageStatus.SENT,
        providerMessageId: sent.providerMessageId ?? null,
        sentAt: sent.sentAt,
        nextAttemptAt: null,
        ...(sent.clearContent ? CLEARED_CONTENT : {}),
      },
    });
  }

  async markRetry(id: string, retry: { nextAttemptAt: Date; error: string }): Promise<void> {
    await this.prisma.emailMessage.update({
      where: { id },
      data: { status: EmailMessageStatus.QUEUED, nextAttemptAt: retry.nextAttemptAt, lastError: retry.error },
    });
  }

  async markThrottled(id: string, nextAttemptAt: Date): Promise<void> {
    await this.prisma.emailMessage.update({
      where: { id },
      data: { status: EmailMessageStatus.QUEUED, nextAttemptAt, attempts: { decrement: 1 } },
    });
  }

  async markFailed(id: string, failed: { error: string; clearContent: boolean }): Promise<void> {
    await this.prisma.emailMessage.update({
      where: { id },
      data: {
        status: EmailMessageStatus.FAILED,
        nextAttemptAt: null,
        lastError: failed.error,
        ...(failed.clearContent ? CLEARED_CONTENT : {}),
      },
    });
  }

  async recordDeliveryOutcome(
    providerMessageId: string,
    outcome: { status: DeliveryOutcomeStatus; error?: string },
  ): Promise<EmailMessage | undefined> {
    await this.prisma.emailMessage.updateMany({
      where: { providerMessageId, status: { in: [...DELIVERY_OUTCOME_FROM[outcome.status]] } },
      data: {
        status: outcome.status,
        ...(outcome.error === undefined ? {} : { lastError: outcome.error }),
      },
    });
    const row = await this.prisma.emailMessage.findFirst({ where: { providerMessageId } });
    return row ? toEmailMessage(row) : undefined;
  }

  async clearContentCreatedBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.emailMessage.updateMany({
      where: { createdAt: { lt: cutoff }, subject: { not: null } },
      data: CLEARED_CONTENT,
    });
    return count;
  }

  async findLatestStateByInvitations(
    invitationIds: string[],
    templateKey: EmailTemplateKey,
  ): Promise<Map<string, EmailMessageState>> {
    if (invitationIds.length === 0) return new Map();
    const rows = await this.prisma.emailMessage.findMany({
      where: { invitationId: { in: invitationIds }, templateKey },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { invitationId: true, status: true, skipReason: true },
    });
    const latest = new Map<string, EmailMessageState>();
    for (const row of rows) {
      if (row.invitationId && !latest.has(row.invitationId)) {
        latest.set(row.invitationId, { status: row.status, skipReason: row.skipReason ?? undefined });
      }
    }
    return latest;
  }
}

function toEmailMessage(row: EmailMessageRow): EmailMessage {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    templateKey: row.templateKey,
    recipientUserId: row.recipientUserId ?? undefined,
    recipientEmail: row.recipientEmail,
    leagueId: row.leagueId ?? undefined,
    contestId: row.contestId ?? undefined,
    entryId: row.entryId ?? undefined,
    invitationId: row.invitationId ?? undefined,
    idempotencyKey: row.idempotencyKey,
    fromName: row.fromName,
    fromAddress: row.fromAddress,
    subject: row.subject ?? undefined,
    textBody: row.textBody ?? undefined,
    htmlBody: row.htmlBody ?? undefined,
    listUnsubscribeUrl: row.listUnsubscribeUrl ?? undefined,
    status: row.status,
    skipReason: row.skipReason ?? undefined,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt ?? undefined,
    lastError: row.lastError ?? undefined,
    providerMessageId: row.providerMessageId ?? undefined,
    sentAt: row.sentAt ?? undefined,
  };
}
