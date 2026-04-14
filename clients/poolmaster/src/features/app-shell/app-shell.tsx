import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-provider';
import { listLeagues } from '@/lib/api';
import { AccountMenu } from '@/features/account/account-menu';
import {
  CreateLeagueModal,
  buildCreateLeagueDestination,
} from '@/features/leagues/create-league-modal';
import { LeagueSelector } from './league-selector';

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAuth();
  const leaguesQuery = useQuery({
    queryKey: ['poolmaster', 'leagues'],
    queryFn: async () => {
      const response = await listLeagues();
      if (!response.data) {
        throw response.error ?? new Error('League list response is missing data.');
      }
      return response.data.leagues;
    },
    enabled: auth.isAuthenticated,
    retry: false,
  });
  const activeLeagueCode = useMemo(() => {
    const match = location.pathname.match(/^\/league\/([^/]+)/);
    return match?.[1] ?? null;
  }, [location.pathname]);
  const isCreateLeagueOpen = searchParams.get('createLeague') === '1';

  function openCreateLeague() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('createLeague', '1');
    setSearchParams(nextParams, { replace: true });
  }

  function closeCreateLeague() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('createLeague');
    setSearchParams(nextParams, { replace: true });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="space-y-1">
              <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Ultimate Office Pool Manager
              </span>
              <h1 className="text-2xl font-semibold tracking-tight">League-first web app</h1>
            </div>

            {auth.isAuthenticated ? (
              <LeagueSelector
                activeLeagueCode={activeLeagueCode}
                leagues={leaguesQuery.data ?? []}
                onCreateLeague={openCreateLeague}
                onNavigate={(path) => navigate(path)}
              />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {auth.isAuthenticated ? (
              <>
                <button
                  aria-label="Notifications"
                  className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground"
                  disabled
                  title="Notifications will be designed next."
                  type="button"
                >
                  Notifications
                </button>
                <button
                  className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground"
                  disabled
                  title="Help content will be designed next."
                  type="button"
                >
                  Help
                </button>
                <AccountMenu
                  displayName={auth.user?.displayName ?? 'Account'}
                  onLogout={() => auth.clearSession().then(() => navigate('/', { replace: true }))}
                />
              </>
            ) : (
              <div className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
                Current route: <span className="font-medium text-foreground">{location.pathname}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        {auth.isAuthenticated ? (
          <nav className="mb-8 flex flex-wrap gap-3">
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-card"
              data-testid="app-nav-my-leagues"
              to="/my-leagues"
            >
              My Leagues
            </Link>
            <button
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground"
              disabled
              title="Contest creation will be implemented in a later slice."
              type="button"
            >
              Create Contest
            </button>
            <button
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground"
              disabled
              title="Contest list routing will be implemented in a later slice."
              type="button"
            >
              Contest List
            </button>
            <button
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground"
              disabled
              title="Standings and history navigation will be implemented in a later slice."
              type="button"
            >
              Standings &amp; History
            </button>
          </nav>
        ) : null}

        <main>
          <Outlet />
        </main>
      </div>

      {auth.isAuthenticated ? (
        <CreateLeagueModal
          isOpen={isCreateLeagueOpen}
          onClose={closeCreateLeague}
          onCreated={(leagueCode) => {
            closeCreateLeague();
            navigate(buildCreateLeagueDestination(leagueCode), { replace: true });
          }}
        />
      ) : null}
    </div>
  );
}
