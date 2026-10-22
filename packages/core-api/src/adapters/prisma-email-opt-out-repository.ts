/**
 * Prisma adapter for EmailOptOutRepository (#844 slice 5): the categories of email each user
 * turned off. A row means off; no row means on.
 */

import type { PrismaClient } from '@prisma/client';
import type { EmailOptOutRepository } from '@poolmaster/shared/db';
import type { OptionalEmailCategory } from '@poolmaster/shared/domain';

export class PrismaEmailOptOutRepository implements EmailOptOutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUser(userId: string): Promise<OptionalEmailCategory[]> {
    const rows = await this.prisma.emailOptOut.findMany({ where: { userId }, select: { category: true } });
    return rows.map((row) => row.category);
  }

  async isOptedOut(userId: string, category: OptionalEmailCategory): Promise<boolean> {
    const row = await this.prisma.emailOptOut.findUnique({
      where: { userId_category: { userId, category } },
      select: { id: true },
    });
    return row !== null;
  }

  async setOptedOut(userId: string, category: OptionalEmailCategory, optedOut: boolean): Promise<void> {
    if (optedOut) {
      // ON CONFLICT DO NOTHING: turning off a category that is already off changes nothing.
      await this.prisma.emailOptOut.createMany({ data: [{ userId, category }], skipDuplicates: true });
    } else {
      await this.prisma.emailOptOut.deleteMany({ where: { userId, category } });
    }
  }
}
