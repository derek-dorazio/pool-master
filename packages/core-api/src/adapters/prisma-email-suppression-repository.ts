/**
 * Prisma adapter for EmailSuppressionRepository (#844 slice 4): addresses the app no longer
 * emails after a permanent bounce or a complaint.
 */

import type { EmailSuppression as EmailSuppressionRow, PrismaClient } from '@prisma/client';
import type { EmailSuppressionRepository } from '@poolmaster/shared/db';
import type { EmailSuppression, EmailSuppressionReason } from '@poolmaster/shared/domain';

export class PrismaEmailSuppressionRepository implements EmailSuppressionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async suppress(input: { email: string; suppressionReason: EmailSuppressionReason; emailMessageId?: string }): Promise<void> {
    // The first bounce or complaint stands; a later report for the same address changes nothing.
    await this.prisma.emailSuppression.createMany({
      data: [{ email: input.email.toLowerCase(), suppressionReason: input.suppressionReason, emailMessageId: input.emailMessageId }],
      skipDuplicates: true,
    });
  }

  async findByEmail(email: string): Promise<EmailSuppression | undefined> {
    const row = await this.prisma.emailSuppression.findUnique({ where: { email: email.toLowerCase() } });
    return row ? toEmailSuppression(row) : undefined;
  }

  async findSuppressedEmails(emails: readonly string[]): Promise<Set<string>> {
    if (emails.length === 0) return new Set();
    const rows = await this.prisma.emailSuppression.findMany({
      where: { email: { in: [...new Set(emails.map((email) => email.toLowerCase()))] } },
      select: { email: true },
    });
    return new Set(rows.map((row) => row.email));
  }
}

function toEmailSuppression(row: EmailSuppressionRow): EmailSuppression {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    email: row.email,
    suppressionReason: row.suppressionReason,
    emailMessageId: row.emailMessageId ?? undefined,
  };
}
