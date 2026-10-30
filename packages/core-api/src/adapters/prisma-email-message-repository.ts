/**
 * Prisma adapter for EmailMessageRepository — the email outbox (#844).
 */

import type { EmailMessage as EmailMessageRow, Prisma, PrismaClient } from '@prisma/client';
import type {
  EmailMessageRecord,
  EmailMessageRecordResult,
  EmailMessageRecordState,
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

  async findById(id: string): Promise<EmailMessage | undefined> {
    const row = await this.prisma.emailMessage.findUnique({ where: { id } });
    return row ? toEmailMessage(row) : undefined;
  }

  async record(input: EmailMessageRecord): Promise<EmailMessageRecordResult> {
    // ON CONFLICT DO NOTHING: a key already recorded writes nothing, and raises nothing that
    // would abort a surrounding transaction.
    const { count } = await this.prisma.emailMessage.createMany({ data: toCreateData(input), skipDuplicates: true });
    const row = await this.prisma.emailMessage.findUniqueOrThrow({
      where: { idempotencyKey: input.idempotencyKey },
    });
    return { message: toEmailMessage(row), created: count === 1 };
  }

  async recordMany(inputs: readonly EmailMessageRecord[]): Promise<EmailMessageRecordState[]> {
    if (inputs.length === 0) return [];
    const state = { id: true, idempotencyKey: true, status: true, skipReason: true } as const;
    // One write answering the rows it wrote, ids and status only (Prisma wraps it in a transaction).
    const written = await this.prisma.emailMessage.createManyAndReturn({
      data: inputs.map(toCreateData),
      skipDuplicates: true,
      select: state,
    });
    const writtenKeys = new Set(written.map((row) => row.idempotencyKey));
    const already = inputs.map((input) => input.idempotencyKey).filter((key) => !writtenKeys.has(key));
    // Only the emails recorded before are read, and only where they stand.
    const stored = already.length === 0 ? [] : await this.prisma.emailMessage.findMany({
      where: { idempotencyKey: { in: [...new Set(already)] } },
      select: state,
    });
    const byKey = new Map([...stored, ...written].map((row) => [row.idempotencyKey, row]));
    const answered = new Set<string>();
    return inputs.map((input) => {
      const row = byKey.get(input.idempotencyKey);
      if (!row) throw new Error(`Email ${input.idempotencyKey} was neither written nor found`);
      // A key the batch names twice was written by its first mention only.
      const created = writtenKeys.has(row.idempotencyKey) && !answered.has(row.idempotencyKey);
      answered.add(row.idempotencyKey);
      return { id: row.id, status: row.status, skipReason: row.skipReason ?? undefined, created };
    });
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

  async clearContentCreatedBetween(from: Date, before: Date): Promise<number> {
    const { count } = await this.prisma.emailMessage.updateMany({
      where: { createdAt: { gte: from, lt: before }, subject: { not: null } },
      data: CLEARED_CONTENT,
    });
    return count;
  }

  async deleteBatchCreatedBefore(cutoff: Date, limit: number): Promise<number> {
    const batch = await this.prisma.emailMessage.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    if (batch.length === 0) return 0;
    const { count } = await this.prisma.emailMessage.deleteMany({
      where: { id: { in: batch.map((row) => row.id) } },
    });
    return count;
  }

  async existsForContest(query: { contestId: string; templateKey: EmailTemplateKey; keyPrefix: string }): Promise<boolean> {
    const row = await this.prisma.emailMessage.findFirst({
      where: { contestId: query.contestId, templateKey: query.templateKey, idempotencyKey: { startsWith: query.keyPrefix } },
      select: { id: true },
    });
    return row !== null;
  }

  async findLeagueIdsRecorded(query: { templateKey: EmailTemplateKey; keyPrefix: string }): Promise<Set<string>> {
    const rows = await this.prisma.emailMessage.findMany({
      where: { templateKey: query.templateKey, idempotencyKey: { startsWith: query.keyPrefix }, leagueId: { not: null } },
      distinct: ['leagueId'],
      select: { leagueId: true },
    });
    return new Set(rows.flatMap((row) => row.leagueId ?? []));
  }

  async findLeagueIdsRecordedByPrefix(query: { templateKey: EmailTemplateKey; keyPrefixes: readonly string[] }): Promise<Map<string, Set<string>>> {
    const recorded = new Map(query.keyPrefixes.map((prefix) => [prefix, new Set<string>()]));
    if (recorded.size === 0) return recorded;
    const rows = await this.prisma.emailMessage.findMany({
      where: {
        templateKey: query.templateKey,
        OR: [...recorded.keys()].map((prefix) => ({ idempotencyKey: { startsWith: prefix } })),
        leagueId: { not: null },
      },
      select: { idempotencyKey: true, leagueId: true },
    });
    for (const row of rows) {
      if (row.leagueId === null) continue;
      for (const [prefix, leagueIds] of recorded) {
        if (row.idempotencyKey.startsWith(prefix)) leagueIds.add(row.leagueId);
      }
    }
    return recorded;
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

/** An email's outbox row as written: its content only when it is queued. */
function toCreateData(input: EmailMessageRecord): Prisma.EmailMessageCreateManyInput {
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
  return input.status === EmailMessageStatus.QUEUED
    ? {
      ...base,
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      listUnsubscribeUrl: input.listUnsubscribeUrl,
      nextAttemptAt: input.dueAt,
    }
    : { ...base, skipReason: input.skipReason };
}
