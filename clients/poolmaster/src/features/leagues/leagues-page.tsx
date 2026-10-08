import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { formatUserName } from '@/features/account/user-name';
import { Button } from '@/features/shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/features/shared/ui/state';
import {
  buildLeaguePath,
  getLeagueSelectorOptions,
  resolveDefaultLeagueCode,
} from './league-routing';
import { useLeaguesQuery } from './use-leagues-query';

export function WelcomePage() {
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { query: leaguesQuery, leagues: allLeagues, commissionerLeagueIds } = useLeaguesQuery();
  // Land only on a league the header selector offers: an inactive league drops out of it for
  // everyone but its commissioner, so it is not somewhere a member should be sent.
  const leagues = allLeagues ? getLeagueSelectorOptions(allLeagues, commissionerLeagueIds) : allLeagues;

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
        body="Try refreshing after signing in again."
        testId="authenticated-landing-error"
        title="We couldn't load your leagues."
      />
    );
  }

  if (!leagues?.length) {
    return (
      <div data-testid="authenticated-landing">
        <EmptyState
          action={
            <>
              <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
                Create your first league
              </p>
              <p className="mb-5 max-w-2xl text-sm text-muted-foreground">
                Start by creating a private league with its own league code, then
                invite your members.
              </p>
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
            </>
          }
          body="Once you create leagues, they'll appear here."
          testId="authenticated-landing-empty"
          title={`Welcome to Ultimate Office Pool Manager, ${formatUserName(
            auth.user?.firstName,
            auth.user?.lastName,
          )}.`}
        />
      </div>
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
