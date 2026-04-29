import { ChevronDown, Inbox } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-provider';
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
  buildLeagueContestHistoryPath,
  buildLeagueContestsPath,
  buildLeagueHistoryPath,
  buildLeagueMyContestsPath,
  buildLeaguePath,
  buildLeagueTeamPath,
  buildLeagueTeamsPath,
} from '@/features/leagues/league-routing';
import { useLeaguesQuery } from '@/features/leagues/use-leagues-query';
import { LeagueSelector } from './league-selector';

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [openMenu, setOpenMenu] = useState<'my-team' | 'league' | null>(null);
  const auth = useAuth();
  const logger = useLogger().child({
    feature: 'app-shell',
  });
  const isManageRoute = location.pathname === '/manage' || location.pathname.startsWith('/manage/');
  const shouldLoadLeagueShell = auth.isAuthenticated && !auth.isRootAdmin && !isManageRoute;
  const leaguesQuery = useLeaguesQuery({
    enabled: shouldLoadLeagueShell,
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
  const canCreateActiveLeagueContest = canManageActiveLeague && activeLeague?.isActive !== false;
  const isCreateLeagueOpen = searchParams.get('createLeague') === '1';
  const leagueMenuDisabled = !activeLeagueCode;

  function closeMenus() {
    setOpenMenu(null);
  }

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
                Prime Time Commissioner
              </span>
              <h1 className="text-2xl font-semibold tracking-tight">ultimate office pool manager</h1>
            </div>

            {shouldLoadLeagueShell ? (
              <>
                <LeagueSelector
                  activeLeagueCode={activeLeagueCode}
                  leagues={leaguesQuery.data ?? []}
                  onCreateLeague={openCreateLeague}
                  onNavigate={(path) => {
                    closeMenus();
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
                <nav className="flex items-center gap-2" aria-label="Primary">
                  <div className="relative">
                    <button
                      aria-expanded={openMenu === 'my-team'}
                      className="inline-flex items-center gap-2 rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 disabled:cursor-not-allowed disabled:text-muted-foreground"
                      data-testid="app-menu-my-team-trigger"
                      disabled={leagueMenuDisabled}
                      onClick={() => setOpenMenu((current) => current === 'my-team' ? null : 'my-team')}
                      type="button"
                    >
                      My Team
                      <ChevronDown aria-hidden size={16} />
                    </button>
                    {openMenu === 'my-team' && activeLeagueCode ? (
                      <div className="absolute left-0 top-full z-40 mt-2 min-w-56 rounded-2xl border border-border bg-card p-2 shadow-xl">
                        <Link
                          className="block rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
                          data-testid="app-menu-my-team-details"
                          onClick={closeMenus}
                          to={buildLeagueTeamPath(activeLeagueCode)}
                        >
                          Team Details
                        </Link>
                        <Link
                          className="block rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
                          data-testid="app-menu-my-contests"
                          onClick={closeMenus}
                          to={buildLeagueMyContestsPath(activeLeagueCode)}
                        >
                          My Contests
                        </Link>
                        <Link
                          className="block rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
                          data-testid="app-menu-my-history"
                          onClick={closeMenus}
                          to={buildLeagueHistoryPath(activeLeagueCode)}
                        >
                          My History
                        </Link>
                      </div>
                    ) : null}
                  </div>

                  <div className="relative">
                    <button
                      aria-expanded={openMenu === 'league'}
                      className="inline-flex items-center gap-2 rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 disabled:cursor-not-allowed disabled:text-muted-foreground"
                      data-testid="app-menu-league-trigger"
                      disabled={leagueMenuDisabled}
                      onClick={() => setOpenMenu((current) => current === 'league' ? null : 'league')}
                      type="button"
                    >
                      League
                      <ChevronDown aria-hidden size={16} />
                    </button>
                    {openMenu === 'league' && activeLeagueCode ? (
                      <div className="absolute left-0 top-full z-40 mt-2 min-w-60 rounded-2xl border border-border bg-card p-2 shadow-xl">
                        <Link
                          className="block rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
                          data-testid="app-menu-league-details"
                          onClick={closeMenus}
                          to={buildLeaguePath(activeLeagueCode)}
                        >
                          League Details
                        </Link>
                        <Link
                          className="block rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
                          data-testid="app-menu-league-teams"
                          onClick={closeMenus}
                          to={buildLeagueTeamsPath(activeLeagueCode)}
                        >
                          Teams and Owners
                        </Link>
                        <Link
                          className="block rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
                          data-testid="app-menu-active-contests"
                          onClick={closeMenus}
                          to={buildLeagueContestsPath(activeLeagueCode)}
                        >
                          Active Contests
                        </Link>
                        <Link
                          className="block rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
                          data-testid="app-menu-contest-history"
                          onClick={closeMenus}
                          to={buildLeagueContestHistoryPath(activeLeagueCode)}
                        >
                          Contest History
                        </Link>
                        {canCreateActiveLeagueContest ? (
                          <Link
                            className="block rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
                            data-testid="app-menu-create-contest"
                            onClick={closeMenus}
                            to={buildLeagueContestCreatePath(activeLeagueCode)}
                          >
                            Create Contest
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </nav>
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {auth.isAuthenticated ? (
              <>
                <button
                  aria-label="Notifications"
                  className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-border text-muted-foreground"
                  data-testid="app-shell-notifications"
                  disabled
                  title="Notifications are not available yet."
                  type="button"
                >
                  <Inbox aria-hidden size={18} />
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
