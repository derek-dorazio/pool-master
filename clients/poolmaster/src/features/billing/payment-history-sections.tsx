import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LeaguePayment, UserPayment } from '@/lib/api';
import { extractErrorMessage } from '@/lib/errors';
import { buildLeagueContestPath, buildLeaguePath } from '@/features/leagues/league-routing';
import { DateDisplay, SettingsSection } from '@/features/shared/ui';
import { formatPriceCents } from './billing-format';
import { useLeaguePaymentsQuery, useMyPaymentsQuery } from './use-payments-queries';

const LEAGUE_DESCRIPTION = 'Every payment made in this league. While payments are off, expanding a contest is free and shows here as $0.';
const MINE_DESCRIPTION = 'What you have paid in your leagues. While payments are off, expanding a contest is free and shows here as $0.';

function PaymentsState({ testId, children }: { testId: string; children: string }) {
  return <div className="px-5 py-3.5 text-sm text-muted-foreground" data-testid={testId}>{children}</div>;
}

/** One line: when, what for (linking to its contest or league), who, and how much. */
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
  return (
    <div
      className="grid gap-x-4 gap-y-1 px-5 py-3.5 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-baseline"
      data-testid={testId}
    >
      <DateDisplay className="text-muted-foreground" timeStyle={null} value={paidAt} />
      <div className="min-w-0">
        <div className="text-foreground">{what}</div>
        {who ? <div className="text-xs text-muted-foreground">{who}</div> : null}
      </div>
      <div className="font-medium tabular-nums text-foreground">{formatPriceCents(amountCents)}</div>
    </div>
  );
}

/**
 * League settings › Payments (#987): the league's payment history for its commissioners and
 * root admins, newest first.
 */
export function LeaguePaymentsSection({ leagueId, leagueCode }: { leagueId: string; leagueCode: string }) {
  const paymentsQuery = useLeaguePaymentsQuery(leagueId);
  return (
    <SettingsSection description={LEAGUE_DESCRIPTION} testId="league-payments" title="Payments">
      {paymentsQuery.isLoading ? <PaymentsState testId="league-payments-loading">Loading payments...</PaymentsState> : null}
      {paymentsQuery.isError ? (
        <PaymentsState testId="league-payments-error">
          {extractErrorMessage(paymentsQuery.error, { fallback: 'We could not load the payments right now.' })}
        </PaymentsState>
      ) : null}
      {paymentsQuery.data?.length === 0 ? <PaymentsState testId="league-payments-empty">No payments yet.</PaymentsState> : null}
      {paymentsQuery.data?.map((payment: LeaguePayment) => (
        <PaymentLine
          amountCents={payment.amountCents}
          key={payment.id}
          paidAt={payment.paidAt}
          testId={`league-payment-${payment.id}`}
          what={payment.contestId
            ? <Link className="hover:underline" to={buildLeagueContestPath(leagueCode, payment.contestId)}>{payment.description}</Link>
            : payment.description}
          who={payment.payer?.name ?? null}
        />
      ))}
    </SettingsSection>
  );
}

/** My profile › Payments (#987): what the signed-in user paid, in any of their leagues. */
export function MyPaymentsSection() {
  const paymentsQuery = useMyPaymentsQuery();
  return (
    <SettingsSection description={MINE_DESCRIPTION} testId="my-payments" title="Payments">
      {paymentsQuery.isLoading ? <PaymentsState testId="my-payments-loading">Loading payments...</PaymentsState> : null}
      {paymentsQuery.isError ? (
        <PaymentsState testId="my-payments-error">
          {extractErrorMessage(paymentsQuery.error, { fallback: 'We could not load your payments right now.' })}
        </PaymentsState>
      ) : null}
      {paymentsQuery.data?.length === 0 ? <PaymentsState testId="my-payments-empty">No payments yet.</PaymentsState> : null}
      {paymentsQuery.data?.map((payment: UserPayment) => (
        <PaymentLine
          amountCents={payment.amountCents}
          key={payment.id}
          paidAt={payment.paidAt}
          testId={`my-payment-${payment.id}`}
          what={<Link className="hover:underline" to={buildLeaguePath(payment.league.leagueCode)}>{payment.description}</Link>}
          who={payment.league.name}
        />
      ))}
    </SettingsSection>
  );
}
