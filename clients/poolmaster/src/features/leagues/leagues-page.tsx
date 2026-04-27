import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router-dom';
import { listLeagues, type ListLeaguesResponses } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { formatUserName } from '@/features/account/user-name';
import {
  buildLeaguePath,
  resolveDefaultLeagueCode,
} from './league-routing';

type LeagueSummary = ListLeaguesResponses[200]['leagues'][number];

export function WelcomePage() {
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const leaguesQuery = useQuery({
    queryKey: ['poolmaster', 'leagues'],
    queryFn: async (): Promise<LeagueSummary[]> => {
      const response = await listLeagues();
      if (!response.data) {
        throw response.error ?? new Error('League list response is missing data.');
      }
      return response.data.leagues;
    },
  });

  if (leaguesQuery.isLoading) {
    return (
      <section
        className="rounded-[2rem] border border-border bg-card p-8"
        data-testid="authenticated-landing-loading"
      >
        <p className="text-sm text-muted-foreground">Loading your leagues...</p>
      </section>
    );
  }

  if (leaguesQuery.isError) {
    return (
      <section
        className="rounded-[2rem] border border-border bg-card p-8"
        data-testid="authenticated-landing-error"
      >
        <h2 className="text-xl font-semibold">We couldn&apos;t load your leagues.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Try refreshing after signing in again.
        </p>
      </section>
    );
  }

  if (!leaguesQuery.data?.length) {
    return (
      <section
        className="rounded-[2rem] border border-border bg-card p-8"
        data-testid="authenticated-landing"
      >
        <div data-testid="authenticated-landing-empty" />
        <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
          Welcome
        </span>
        <h2 className="mt-4 text-2xl font-semibold">
          Welcome to Ultimate Office Pool Manager,{' '}
          {formatUserName(auth.user?.firstName, auth.user?.lastName)}.
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Once you create leagues, they&apos;ll appear here.
        </p>
        <div className="mt-6 rounded-[1.5rem] border border-dashed border-border bg-background p-5">
          <h3 className="text-lg font-semibold">Create your first league</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Start by creating a private league with its own league code. Once it
            exists, this home flow will route you directly into that league
            context.
          </p>
          <button
            className="mt-5 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
            data-testid="welcome-create-league"
            onClick={() => {
              const nextParams = new URLSearchParams(searchParams);
              nextParams.set('createLeague', '1');
              setSearchParams(nextParams, { replace: true });
            }}
            type="button"
          >
            Create league
          </button>
        </div>
      </section>
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
