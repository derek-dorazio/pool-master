import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { LeaguePayment, UserPayment } from '@/lib/api';
import { extractErrorMessage } from '@/lib/errors';
import { buildContestLandingPath, buildLeaguePath } from '@/features/leagues/league-routing';
import { DateDisplay, QueryState, SectionCard, SectionRow, SectionRows, formatMoneyCents, useDisplayPreferences } from '@/features/shared/ui';
import { useLeaguePaymentsQuery, useMyPaymentsQuery } from './use-payments-queries';

const LEAGUE_DESCRIPTION = 'Every payment made in this league. While payments are off, expanding a contest is free and shows here as $0.';
const MINE_DESCRIPTION = 'What you have paid in your leagues. While payments are off, expanding a contest is free and shows here as $0.';

/** One payment row: what it was for (linking to its contest or league), when and who, and how much. */
function PaymentLine({
  testId,
  paidAt,
  what,
  who,
  amountCents,
}: {
  testId: string;
  paidAt: string;
  what: ReactNode;
  who: string | null;
  amountCents: number;
}) {
  const { locale } = useDisplayPreferences();
  return (
    <SectionRow
      facts={(
        <>
          <DateDisplay timeStyle={null} tone="inherit" value={paidAt} />
          {who ? ` · ${who}` : null}
        </>
      )}
      name={what}
      testId={testId}
      value={formatMoneyCents(amountCents, locale)}
    />
  );
}

/**
 * League settings › Payments (#987): the league's payment history for its commissioners and
 * root admins, newest first.
 */
export function LeaguePaymentsSection({ leagueId, leagueCode }: { leagueId: string; leagueCode: string }) {
  const paymentsQuery = useLeaguePaymentsQuery(leagueId);
  return (
    <SectionCard help={LEAGUE_DESCRIPTION} testId="league-payments" title="Payments">
      <QueryState
          empty="No payments yet."
          error={extractErrorMessage(paymentsQuery.error, { fallback: 'We could not load the payments right now.' })}
          isEmpty={(payments) => payments.length === 0}
          loading="Loading payments..."
          query={paymentsQuery}
          rows={3}
          testId="league-payments"
        >
          {(payments) => (
            <SectionRows>
              {payments.map((payment: LeaguePayment) => (
            <PaymentLine
              amountCents={payment.amountCents}
              key={payment.id}
              paidAt={payment.paidAt}
              testId={`league-payment-${payment.id}`}
              what={payment.contest
                ? <Link className="hover:underline" to={buildContestLandingPath(leagueCode, payment.contest)}>{payment.description}</Link>
                : payment.description}
              who={payment.payer?.name ?? null}
            />
          ))}
            </SectionRows>
          )}
        </QueryState>
    </SectionCard>
  );
}

/** My account › Payments (#987): what the signed-in user paid, in any of their leagues. */
export function MyPaymentsSection() {
  const paymentsQuery = useMyPaymentsQuery();
  return (
    <SectionCard help={MINE_DESCRIPTION} testId="my-payments" title="Payments">
      <QueryState
          empty="No payments yet."
          error={extractErrorMessage(paymentsQuery.error, { fallback: 'We could not load your payments right now.' })}
          isEmpty={(payments) => payments.length === 0}
          loading="Loading payments..."
          query={paymentsQuery}
          rows={3}
          testId="my-payments"
        >
          {(payments) => (
            <SectionRows>
              {payments.map((payment: UserPayment) => (
            <PaymentLine
              amountCents={payment.amountCents}
              key={payment.id}
              paidAt={payment.paidAt}
              testId={`my-payment-${payment.id}`}
              what={<Link className="hover:underline" to={buildLeaguePath(payment.league.leagueCode)}>{payment.description}</Link>}
              who={payment.league.name}
            />
          ))}
            </SectionRows>
          )}
        </QueryState>
    </SectionCard>
  );
}
