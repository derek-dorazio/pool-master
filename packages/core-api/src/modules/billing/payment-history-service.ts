/**
 * PaymentHistoryService (#987): a league's payment history for its commissioners, and the
 * payments a user made across their leagues for their Account page (plans/payments.md §8).
 * Every line is a real record: $0 lines say they were free, and no card data is kept.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { LeaguePaymentRecord, LeaguePaymentRepository, PayerPaymentRecord } from '@poolmaster/shared/db';
import { LeaguePaymentKind } from '@poolmaster/shared/domain';

/**
 * The kinds a payer actually pays, listed on their account. A root admin's grant is Poolmaster's
 * gift, not the admin's payment; a new kind joins this list on purpose.
 */
const PAID_BY_PAYER: readonly LeaguePaymentKind[] = [LeaguePaymentKind.CONTEST_EXPANSION_PAYMENTS_OFF];

export class PaymentHistoryService {
  constructor(private readonly deps: { payments: LeaguePaymentRepository; logger: FastifyBaseLogger }) {}

  async listForLeague(leagueId: string): Promise<LeaguePaymentRecord[]> {
    const payments = await this.deps.payments.listForLeague(leagueId);
    this.deps.logger.debug({ action: 'paymentHistory.league', data: { leagueId, count: payments.length } }, 'Listed league payments');
    // A grant reads "given free by" the product name; the staff member who gave it isn't league data.
    return payments.map((payment) => (payment.kind === LeaguePaymentKind.CONTEST_EXPANSION_GRANT ? { ...payment, payer: null } : payment));
  }

  async listForPayer(userId: string): Promise<PayerPaymentRecord[]> {
    const payments = await this.deps.payments.listForPayer(userId, PAID_BY_PAYER);
    this.deps.logger.debug({ action: 'paymentHistory.payer', data: { userId, count: payments.length } }, 'Listed a user\'s payments');
    return payments;
  }
}
