import { Navigate, useSearchParams } from 'react-router';
import { useAuth } from '@/features/auth/auth-context';
import { formatUserName } from '@/features/account/user-name';
import { MANAGE_LANDING_PATH } from '@/features/root-admin/manage-navigation';
import { Button, ErrorState, LoadingState, PageHeader, SectionCard, SectionEmpty } from '@/features/shared/ui';
import {
  buildLeaguePath,
  getLeagueSelectorOptions,
  resolveDefaultLeagueCode,
} from './league-routing';
import { useLeaguesQuery } from './use-leagues-query';
import { ComingUpRow } from '@/features/event-pages/coming-up-row';
import { PRODUCT_NAME } from '@poolmaster/shared/domain';

export function WelcomePage() {
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // A root admin's home is Manage (#658); the member landing below is for everyone else.
  const { query: leaguesQuery, leagues: allLeagues, commissionerLeagueIds } = useLeaguesQuery({
    enabled: !auth.isRootAdmin,
  });
  // Land only on a league the header selector offers: an inactive league drops out of it for
  // everyone but its commissioner, so it is not somewhere a member should be sent.
  const leagues = allLeagues ? getLeagueSelectorOptions(allLeagues, commissionerLeagueIds) : allLeagues;

  if (auth.isRootAdmin) {
    return <Navigate replace to={MANAGE_LANDING_PATH} />;
  }

  if (leaguesQuery.isLoading) {
    return (
      <LoadingState
        body="Loading your leagues..."
        testId="authenticated-landing-loading"
      />
    );
  }

  if (leaguesQuery.isError) {
    return (
      <ErrorState
        body="We couldn't load your leagues."
        onRetry={() => void leaguesQuery.refetch()}
        testId="authenticated-landing-error"
      />
    );
  }

  if (!leagues?.length) {
    return (
      <section className="space-y-8" data-testid="authenticated-landing">
        <PageHeader
          actions={(
            <Button
              data-testid="welcome-create-league"
              onClick={() => {
                const nextParams = new URLSearchParams(searchParams);
                nextParams.set('createLeague', '1');
                setSearchParams(nextParams, { replace: true });
              }}
              type="button"
            >
              Create league
            </Button>
          )}
          title={`Welcome to ${PRODUCT_NAME}, ${formatUserName(auth.user?.firstName, auth.user?.lastName)}.`}
        />
        <SectionCard testId="authenticated-landing-empty" title="Your leagues">
          <SectionEmpty testId="authenticated-landing-empty-line">No leagues yet.</SectionEmpty>
        </SectionCard>
        <ComingUpRow testId="welcome-coming-up" />
      </section>
    );
  }

  const defaultLeagueCode = resolveDefaultLeagueCode(leagues);

  return (
    <Navigate
      replace
      to={buildLeaguePath(defaultLeagueCode ?? leagues[0].leagueCode)}
    />
  );
}
