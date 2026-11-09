import type { LeaguePaymentRecord, LeaguePaymentRepository } from '@poolmaster/shared/db';
import { LeaguePaymentKind } from '@poolmaster/shared/domain';
import { PaymentHistoryService } from '../../../packages/core-api/src/modules/billing/payment-history-service';
import { fakeLogger } from '../../support/fake-logger';

// Payment history (#987): a league's payments for its commissioners, with a root admin's grant
// shown without the staff member who gave it, and a user's own payments, which leave grants out.

const payer = { id: 'user-1', firstName: 'Casey', lastName: 'Commish', username: 'casey', email: 'casey@example.com' };
const payment = (id: string, kind: LeaguePaymentKind): LeaguePaymentRecord =>
  ({ id, kind, contest: null, payer, amountCents: 0, description: id, paidAt: new Date('2026-11-01') });

function service(rows: LeaguePaymentRecord[]) {
  const listForPayer = jest.fn().mockResolvedValue([]);
  const payments = { listForLeague: async () => rows, listForPayer } as unknown as LeaguePaymentRepository;
  return { history: new PaymentHistoryService({ payments, logger: fakeLogger() }), listForPayer };
}

describe('PaymentHistoryService', () => {
  it('lists a league\'s payments with a grant\'s giver left out and a paid line\'s payer kept', async () => {
    const { history } = service([payment('paid', LeaguePaymentKind.CONTEST_EXPANSION_PAYMENTS_OFF), payment('gift', LeaguePaymentKind.CONTEST_EXPANSION_GRANT)]);

    const listed = await history.listForLeague('league-1');

    expect(listed.map((row) => [row.id, row.payer])).toEqual([['paid', payer], ['gift', null]]);
  });

  it('reads a user\'s payments of only the kinds a payer pays, leaving grants out', async () => {
    const { history, listForPayer } = service([]);

    await history.listForPayer('user-1');

    expect(listForPayer).toHaveBeenCalledWith('user-1', [LeaguePaymentKind.CONTEST_EXPANSION_PAYMENTS_OFF]);
  });
});
