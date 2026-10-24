/**
 * Billing mappers (#987): payment history lines → the DTOs a league's commissioners and the
 * payer read them from.
 */
import type { LeaguePaymentRecord, PayerPaymentRecord } from '@poolmaster/shared/db';
import type { LeaguePaymentListResponse, UserPaymentListResponse } from '@poolmaster/shared/dto';
import { formatUserName } from '../modules/email/email-content';

export function toLeaguePaymentListResponse(payments: readonly LeaguePaymentRecord[]): LeaguePaymentListResponse {
  return {
    payments: payments.map((payment) => ({
      id: payment.id,
      paidAt: payment.paidAt.toISOString(),
      amountCents: payment.amountCents,
      description: payment.description,
      contestId: payment.contestId,
      payer: payment.payer ? { id: payment.payer.id, name: formatUserName(payment.payer) } : null,
    })),
  };
}

export function toUserPaymentListResponse(payments: readonly PayerPaymentRecord[]): UserPaymentListResponse {
  return {
    payments: payments.map((payment) => ({
      id: payment.id,
      paidAt: payment.paidAt.toISOString(),
      amountCents: payment.amountCents,
      description: payment.description,
      league: { ...payment.league },
    })),
  };
}
