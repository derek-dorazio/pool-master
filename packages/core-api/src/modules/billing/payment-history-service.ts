/**
 * PaymentHistoryService (#987): a league's payment history for its commissioners, and the
 * payments a user made across their leagues for their Account page (plans/payments.md §8).
 * Every line is a real record: $0 lines say they were free, and no card data is kept.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { LeaguePaymentRecord, LeaguePaymentRepository, PayerPaymentRecord } from '@poolmaster/shared/db';

export class PaymentHistoryService {
  constructor(private readonly deps: { payments: LeaguePaymentRepository; logger: FastifyBaseLogger }) {}

  async listForLeague(leagueId: string): Promise<LeaguePaymentRecord[]> {
    const payments = await this.deps.payments.listForLeague(leagueId);
    this.deps.logger.debug({ action: 'paymentHistory.league', data: { leagueId, count: payments.length } }, 'Listed league payments');
    return payments;
  }

  async listForPayer(userId: string): Promise<PayerPaymentRecord[]> {
    const payments = await this.deps.payments.listForPayer(userId);
    this.deps.logger.debug({ action: 'paymentHistory.payer', data: { userId, count: payments.length } }, 'Listed a user\'s payments');
    return payments;
  }
}
