import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-provider';
import { formatUserName } from '@/features/account/user-name';
import { Button } from '@/features/shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/features/shared/ui/state';
import {
  buildLeaguePath,
  resolveDefaultLeagueCode,
} from './league-routing';
import { useLeaguesQuery } from './use-leagues-query';

export function WelcomePage() {
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const leaguesQuery = useLeaguesQuery();

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

  if (!leaguesQuery.data?.length) {
    return (
      <EmptyState
        action={
          <>
            <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
              Create your first league
            </p>
            <p className="mb-5 max-w-2xl text-sm text-muted-foreground">
              Start by creating a private league with its own league code. Once it
              exists, this home flow will route you directly into that league
              context.
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
    );
  }

  const defaultLeagueCode = resolveDefaultLeagueCode(leaguesQuery.data);

  return (
    <Navigate
      replace
      to={buildLeaguePath(defaultLeagueCode ?? leaguesQuery.data[0]!.leagueCode)}
    />
  );
}
