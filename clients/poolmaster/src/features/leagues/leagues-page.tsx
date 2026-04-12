import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { listLeagues, type ListLeaguesResponses } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import {
  buildLeaguePath,
  getLeagueInitials,
  resolveDefaultLeagueCode,
  sortLeaguesForOverview,
} from './league-routing';

type LeagueSummary = ListLeaguesResponses[200]['leagues'][number];

function roleLabel(role: string | undefined) {
  if (!role) {
    return 'Member';
  }

  return role
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

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
          This route is wired to the generated SDK and current backend contracts. Try refreshing
          after signing in again.
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
          Welcome to Ultimate Office Pool Manager, {auth.user?.displayName ?? 'Commissioner'}.
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          This is your normal app home. Once you create leagues, they&apos;ll appear here. For a
          brand-new commissioner account, the next step is creating your first league.
        </p>
        <div className="mt-6 rounded-[1.5rem] border border-dashed border-border bg-background p-5">
          <h3 className="text-lg font-semibold">Create your first league</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Start by creating a private or public league. Once it exists, this home flow will
            route you directly into that league context.
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
  if (defaultLeagueCode) {
    return <Navigate replace to={buildLeaguePath(defaultLeagueCode)} />;
  }

  return (
    <section className="space-y-5" data-testid="authenticated-landing">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Member
          </span>
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Your leagues</h2>
            <p className="text-sm text-muted-foreground">
              This first real route reads directly through the generated SDK against the rebuilt
              backend.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {leaguesQuery.data.map((league) => (
          <article
            className="rounded-[1.75rem] border border-border bg-card p-5 shadow-sm"
            key={league.id}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                {roleLabel(league.role)}
              </span>
              <span className="text-xs text-muted-foreground">{league.visibility}</span>
            </div>
            <h3 className="mt-4 text-xl font-semibold">{league.name}</h3>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-muted-foreground">
              <div className="rounded-2xl bg-background px-3 py-3">
                <dt>Members</dt>
                <dd className="mt-1 text-lg font-semibold text-foreground">{league.memberCount}</dd>
              </div>
              <div className="rounded-2xl bg-background px-3 py-3">
                <dt>Active contests</dt>
                <dd className="mt-1 text-lg font-semibold text-foreground">
                  {league.activeContestCount}
                </dd>
              </div>
            </dl>
            <Link
              className="mt-5 inline-flex text-sm font-medium text-primary hover:underline"
              to={buildLeaguePath(league.leagueCode)}
            >
              Open league
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

export function MyLeaguesPage() {
  const auth = useAuth();
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
      <section className="rounded-[2rem] border border-border bg-card p-8" data-testid="my-leagues-loading">
        <p className="text-sm text-muted-foreground">Loading your leagues...</p>
      </section>
    );
  }

  if (leaguesQuery.isError) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8" data-testid="my-leagues-error">
        <h2 className="text-xl font-semibold">We couldn&apos;t load your leagues.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Try refreshing after signing in again. This page reads directly from the current league
          contract and generated SDK.
        </p>
      </section>
    );
  }

  if (!leaguesQuery.data?.length) {
    return <Navigate replace to="/welcome" />;
  }

  const leagues = sortLeaguesForOverview(leaguesQuery.data);

  return (
    <section className="space-y-6" data-testid="my-leagues-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
          League Directory
        </span>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight">My leagues</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Keep the header selector quick for everyday switching, and use this page when you want a
          fuller view of active and inactive league state.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {leagues.map((league) => {
          const isCommissioner = league.role === 'COMMISSIONER';
          const isInactive = league.isActive === false;

          return (
            <article
              className={`rounded-[1.75rem] border p-5 shadow-sm ${
                isInactive ? 'border-amber-200 bg-amber-50/70' : 'border-border bg-card'
              }`}
              data-testid={`league-tile-${league.leagueCode}`}
              key={league.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    {roleLabel(league.role)}
                  </span>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                    <span>{league.visibility}</span>
                    <span aria-hidden="true">·</span>
                    <span>{isInactive ? 'Inactive' : 'Active'}</span>
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {getLeagueInitials(league.name)}
                </div>
              </div>

              <h3 className="mt-4 text-xl font-semibold">{league.name}</h3>
              <p className="mt-2 min-h-10 text-sm text-muted-foreground">
                {isInactive
                  ? isCommissioner
                    ? 'This league is not currently active. You still have access here so future reactivation or renewal tools can live in the same league context.'
                    : 'This league is not currently active. You can still open the league home in read-only mode and contact the commissioner from there.'
                  : league.description?.trim() || 'League home, contests, members, and commissioner actions all hang off this league context.'}
              </p>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-muted-foreground">
                <div className="rounded-2xl bg-background px-3 py-3">
                  <dt>Members</dt>
                  <dd className="mt-1 text-lg font-semibold text-foreground">{league.memberCount}</dd>
                </div>
                <div className="rounded-2xl bg-background px-3 py-3">
                  <dt>Active contests</dt>
                  <dd className="mt-1 text-lg font-semibold text-foreground">
                    {league.activeContestCount}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  className="inline-flex rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
                  to={buildLeaguePath(league.leagueCode)}
                >
                  Open league
                </Link>

                {isInactive ? (
                  isCommissioner ? (
                    <button
                      className="rounded-2xl border border-amber-300 bg-white px-4 py-3 text-sm font-medium text-amber-950"
                      data-testid={`league-tile-reactivate-${league.leagueCode}`}
                      disabled
                      title="Reactivation and renewal tools are planned in a later slice."
                      type="button"
                    >
                      Reactivate league
                    </button>
                  ) : (
                    <button
                      className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground"
                      data-testid={`league-tile-message-commissioner-${league.leagueCode}`}
                      disabled
                      title="Commissioner messaging will be added in a later slice."
                      type="button"
                    >
                      Message commissioner
                    </button>
                  )
                ) : (
                  <button
                    className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground"
                    data-testid={`league-tile-manage-${league.leagueCode}`}
                    disabled
                    title="League management actions will expand in later slices."
                    type="button"
                  >
                    Manage league
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="rounded-[2rem] border border-border bg-card p-6">
        <h3 className="text-xl font-semibold">Current review focus</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is the richer league-management surface for reviewing active and inactive
          states. Renewal, archiving, and notification flows remain deferred while we focus on the
          current league home and create-league experiences.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{auth.user?.displayName ?? 'Member'}</span>.
        </p>
      </div>
    </section>
  );
}
