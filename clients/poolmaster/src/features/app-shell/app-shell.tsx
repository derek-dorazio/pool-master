import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-provider';
import { listLeagues } from '@/lib/api';
import { useLogger } from '@/lib/logger';
import { AccountMenu } from '@/features/account/account-menu';
import { buildUserPath } from '@/features/account/user-routing';
import { formatUserName } from '@/features/account/user-name';
import {
  CreateLeagueModal,
  buildCreateLeagueDestination,
} from '@/features/leagues/create-league-modal';
import {
  buildLeagueContestCreatePath,
  buildLeagueContestsPath,
  buildLeagueContestsManagePath,
  buildLeagueHistoryPath,
  buildLeaguePath,
} from '@/features/leagues/league-routing';
import { LeagueSelector } from './league-selector';

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAuth();
  const logger = useLogger().child({
    feature: 'app-shell',
  });
  const isManageRoute = location.pathname === '/manage' || location.pathname.startsWith('/manage/');
  const shouldLoadLeagueShell = auth.isAuthenticated && !isManageRoute;
  const leaguesQuery = useQuery({
    queryKey: ['poolmaster', 'leagues'],
    queryFn: async () => {
      const response = await listLeagues();
      if (!response.data) {
        throw response.error ?? new Error('League list response is missing data.');
      }
      return response.data.leagues;
    },
    enabled: shouldLoadLeagueShell,
    retry: false,
  });
  const activeLeagueCode = useMemo(() => {
    const match = location.pathname.match(/^\/league\/([^/]+)/);
    return match?.[1] ?? null;
  }, [location.pathname]);
  const activeLeague = useMemo(
    () => leaguesQuery.data?.find((league) => league.leagueCode === activeLeagueCode) ?? null,
    [activeLeagueCode, leaguesQuery.data],
  );
  const canManageActiveLeague = Boolean(
    activeLeagueCode && (activeLeague?.leagueRelationship.commissioner || activeLeague?.isRootAdmin),
  );
  const isCreateLeagueOpen = searchParams.get('createLeague') === '1';

  function openCreateLeague() {
    logger.info(
      {
        action: 'appShell.createLeagueModal.opened',
        data: {
          from: location.pathname,
        },
      },
      'Opened create-league modal from app shell',
    );
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('createLeague', '1');
    setSearchParams(nextParams, { replace: true });
  }

  function closeCreateLeague() {
    logger.debug(
      {
        action: 'appShell.createLeagueModal.closed',
        data: {
          from: location.pathname,
        },
      },
      'Closed create-league modal from app shell',
    );
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('createLeague');
    setSearchParams(nextParams, { replace: true });
  }

  useEffect(() => {
    if (!shouldLoadLeagueShell || !leaguesQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'appShell.leagues.failed',
        err: leaguesQuery.error instanceof Error ? leaguesQuery.error : undefined,
        data: {
          path: location.pathname,
        },
      },
      'App shell failed to load leagues for the authenticated user',
    );
  }, [leaguesQuery.error, leaguesQuery.isError, location.pathname, logger, shouldLoadLeagueShell]);

  useEffect(() => {
    if (!shouldLoadLeagueShell || !leaguesQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'appShell.loaded',
        data: {
          path: location.pathname,
          activeLeagueCode,
          leagueCount: leaguesQuery.data.length,
        },
      },
      'Loaded authenticated app shell state',
    );
  }, [activeLeagueCode, leaguesQuery.data, location.pathname, logger, shouldLoadLeagueShell]);

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

            {shouldLoadLeagueShell ? (
              <LeagueSelector
                activeLeagueCode={activeLeagueCode}
                leagues={leaguesQuery.data ?? []}
                onCreateLeague={openCreateLeague}
                onNavigate={(path) => {
                  logger.info(
                    {
                      action: 'appShell.league.navigate',
                      data: {
                        from: location.pathname,
                        to: path,
                      },
                    },
                    'Navigating to selected league from app shell',
                  );
                  navigate(path);
                }}
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
                  isRootAdmin={auth.isRootAdmin}
                  profilePath={auth.user?.id ? buildUserPath(auth.user.id) : '/'}
                  userName={formatUserName(auth.user?.firstName, auth.user?.lastName)}
                  onLogout={async () => {
                    logger.info(
                      {
                        action: 'appShell.logout.started',
                        data: {
                          userId: auth.user?.id ?? null,
                        },
                      },
                      'Started logout from the app shell',
                    );

                    await auth.clearSession();
                    navigate('/', { replace: true });
                    logger.info(
                      {
                        action: 'appShell.logout.completed',
                        data: {
                          userId: auth.user?.id ?? null,
                        },
                      },
                      'Completed logout from the app shell',
                    );
                  }}
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
        {shouldLoadLeagueShell ? (
          <nav className="mb-8 flex flex-wrap gap-3">
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-card"
              data-testid="app-nav-league-home"
              to={activeLeagueCode ? buildLeaguePath(activeLeagueCode) : '/welcome'}
            >
              League Home
            </Link>
            {activeLeagueCode ? (
              <Link
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-card"
                data-testid="app-nav-create-contest"
                to={buildLeagueContestCreatePath(activeLeagueCode)}
              >
                Create Contest
              </Link>
            ) : (
              <button
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground"
                data-testid="app-nav-create-contest-disabled"
                disabled
                title="Open a league first to create a contest."
                type="button"
              >
                Create Contest
              </button>
            )}
            {canManageActiveLeague ? (
              <Link
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-card"
                data-testid="app-nav-manage-contests"
                to={buildLeagueContestsManagePath(activeLeagueCode ?? '')}
              >
                Manage Contests
              </Link>
            ) : null}
            {activeLeagueCode ? (
              <>
                <Link
                  className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-card"
                  data-testid="app-nav-contest-list"
                  to={buildLeagueContestsPath(activeLeagueCode)}
                >
                  League Contests
                </Link>
                <Link
                  className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-card"
                  data-testid="app-nav-my-history"
                  to={buildLeagueHistoryPath(activeLeagueCode)}
                >
                  My History
                </Link>
              </>
            ) : (
              <>
                <button
                  className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground"
                  disabled
                  title="Open a league first to browse its contests."
                  type="button"
                >
                  League Contests
                </button>
                <button
                  className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground"
                  disabled
                  title="Open a league first to browse your contest history."
                  type="button"
                >
                  My History
                </button>
              </>
            )}
          </nav>
        ) : null}

        <main>
          <Outlet />
        </main>
      </div>

      {shouldLoadLeagueShell ? (
        <CreateLeagueModal
          isOpen={isCreateLeagueOpen}
          onClose={closeCreateLeague}
          onCreated={(leagueCode) => {
            closeCreateLeague();
            logger.info(
              {
                action: 'appShell.createLeagueModal.completed',
                data: {
                  leagueCode,
                },
              },
              'Created a league from the app shell modal',
            );
            navigate(buildCreateLeagueDestination(leagueCode), { replace: true });
          }}
        />
      ) : null}
    </div>
  );
}
