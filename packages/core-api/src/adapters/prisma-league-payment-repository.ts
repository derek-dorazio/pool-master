import type { PrismaClient } from '@prisma/client';
import type { LeaguePaymentRecord, LeaguePaymentRepository, PayerPaymentRecord } from '@poolmaster/shared/db';

/** A league's payment history, and a user's payments across leagues (#987). */
export class PrismaLeaguePaymentRepository implements LeaguePaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listForLeague(leagueId: string): Promise<LeaguePaymentRecord[]> {
    return this.prisma.leaguePayment.findMany({
      where: { leagueId },
      orderBy: [{ paidAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        contestId: true,
        amountCents: true,
        description: true,
        paidAt: true,
        payer: { select: { id: true, firstName: true, lastName: true, username: true, email: true } },
      },
    });
  }

  async listForPayer(userId: string): Promise<PayerPaymentRecord[]> {
    return this.prisma.leaguePayment.findMany({
      where: { payerId: userId },
      orderBy: [{ paidAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        amountCents: true,
        description: true,
        paidAt: true,
        league: { select: { id: true, name: true, leagueCode: true } },
      },
    });
  }
}
