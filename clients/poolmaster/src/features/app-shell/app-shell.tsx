import { Inbox } from "lucide-react";
import { useEffect, useMemo } from "react";
import {
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useAuth } from "@/features/auth/auth-provider";
import { useLogger } from "@/lib/logger";
import { AccountMenu } from "@/features/account/account-menu";
import { buildUserPath } from "@/features/account/user-routing";
import { formatUserName } from "@/features/account/user-name";
import {
  AppIconActionButton,
  AppNavigationMenu,
  type AppNavigationItem,
} from "@/features/shared/ui";
import {
  CreateLeagueModal,
  buildCreateLeagueDestination,
} from "@/features/leagues/create-league-modal";
import {
  buildLeagueContestCreatePath,
  buildLeagueContestHistoryPath,
  buildLeagueContestsPath,
  buildLeagueHistoryPath,
  buildLeagueMyContestsPath,
  buildLeaguePath,
  buildLeagueTeamPath,
  buildLeagueTeamsPath,
} from "@/features/leagues/league-routing";
import { useLeaguesQuery } from "@/features/leagues/use-leagues-query";
import { LeagueSelector } from "./league-selector";

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAuth();
  const logger = useLogger().child({
    feature: "app-shell",
  });
  const isManageRoute =
    location.pathname === "/manage" || location.pathname.startsWith("/manage/");
  const shouldLoadLeagueShell =
    auth.isAuthenticated && !auth.isRootAdmin && !isManageRoute;
  const leaguesQuery = useLeaguesQuery({
    enabled: shouldLoadLeagueShell,
  });
  const activeLeagueCode = useMemo(() => {
    const match = location.pathname.match(/^\/league\/([^/]+)/);
    return match?.[1] ?? null;
  }, [location.pathname]);
  const activeLeague = useMemo(
    () =>
      leaguesQuery.data?.find(
        (league) => league.leagueCode === activeLeagueCode,
      ) ?? null,
    [activeLeagueCode, leaguesQuery.data],
  );
  const canManageActiveLeague = Boolean(
    activeLeagueCode &&
    (activeLeague?.leagueRelationship.commissioner ||
      activeLeague?.isRootAdmin),
  );
  const canCreateActiveLeagueContest =
    canManageActiveLeague && activeLeague?.isActive !== false;
  const isCreateLeagueOpen = searchParams.get("createLeague") === "1";
  const leagueMenuDisabled = !activeLeagueCode;
  const currentRoute = `${location.pathname}${location.search}`;
  const appMenuClassName =
    "border-inverse-border bg-on-inverse-subtle text-on-inverse hover:border-primary/50 hover:bg-on-inverse-hover disabled:text-on-inverse-muted";

  const myTeamMenuItems = useMemo<AppNavigationItem[]>(() => {
    if (!activeLeagueCode) {
      return [];
    }

    const teamPath = buildLeagueTeamPath(activeLeagueCode);
    const myContestsPath = buildLeagueMyContestsPath(activeLeagueCode);
    const historyPath = buildLeagueHistoryPath(activeLeagueCode);

    return [
      {
        isActive: location.pathname === teamPath,
        label: "Team Details",
        testId: "app-menu-my-team-details",
        to: teamPath,
      },
      {
        isActive: currentRoute === myContestsPath,
        label: "My Contests",
        testId: "app-menu-my-contests",
        to: myContestsPath,
      },
      {
        isActive: location.pathname === historyPath,
        label: "My History",
        testId: "app-menu-my-history",
        to: historyPath,
      },
    ];
  }, [activeLeagueCode, currentRoute, location.pathname]);

  const leagueMenuItems = useMemo<AppNavigationItem[]>(() => {
    if (!activeLeagueCode) {
      return [];
    }

    const leaguePath = buildLeaguePath(activeLeagueCode);
    const teamsPath = buildLeagueTeamsPath(activeLeagueCode);
    const contestsPath = buildLeagueContestsPath(activeLeagueCode);
    const contestHistoryPath = buildLeagueContestHistoryPath(activeLeagueCode);

    return [
      {
        isActive: location.pathname === leaguePath,
        label: "League Details",
        testId: "app-menu-league-details",
        to: leaguePath,
      },
      {
        isActive: location.pathname === teamsPath,
        label: "Teams and Owners",
        testId: "app-menu-league-teams",
        to: teamsPath,
      },
      {
        isActive: currentRoute === contestsPath,
        label: "Active Contests",
        testId: "app-menu-active-contests",
        to: contestsPath,
      },
      {
        isActive: location.pathname === contestHistoryPath,
        label: "Contest History",
        testId: "app-menu-contest-history",
        to: contestHistoryPath,
      },
      {
        hidden: !canCreateActiveLeagueContest,
        label: "Create Contest",
        testId: "app-menu-create-contest",
        to: buildLeagueContestCreatePath(activeLeagueCode),
      },
    ];
  }, [
    activeLeagueCode,
    canCreateActiveLeagueContest,
    currentRoute,
    location.pathname,
  ]);

  function openCreateLeague() {
    logger.info(
      {
        action: "appShell.createLeagueModal.opened",
        data: {
          from: location.pathname,
        },
      },
      "Opened create-league modal from app shell",
    );
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("createLeague", "1");
    setSearchParams(nextParams, { replace: true });
  }

  function closeCreateLeague() {
    logger.debug(
      {
        action: "appShell.createLeagueModal.closed",
        data: {
          from: location.pathname,
        },
      },
      "Closed create-league modal from app shell",
    );
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("createLeague");
    setSearchParams(nextParams, { replace: true });
  }

  useEffect(() => {
    if (!shouldLoadLeagueShell || !leaguesQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: "appShell.leagues.failed",
        err:
          leaguesQuery.error instanceof Error ? leaguesQuery.error : undefined,
        data: {
          path: location.pathname,
        },
      },
      "App shell failed to load leagues for the authenticated user",
    );
  }, [
    leaguesQuery.error,
    leaguesQuery.isError,
    location.pathname,
    logger,
    shouldLoadLeagueShell,
  ]);

  useEffect(() => {
    if (!shouldLoadLeagueShell || !leaguesQuery.data) {
      return;
    }

    logger.info(
      {
        action: "appShell.loaded",
        data: {
          path: location.pathname,
          activeLeagueCode,
          leagueCount: leaguesQuery.data.length,
        },
      },
      "Loaded authenticated app shell state",
    );
  }, [
    activeLeagueCode,
    leaguesQuery.data,
    location.pathname,
    logger,
    shouldLoadLeagueShell,
  ]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-inverse-border bg-surface-inverse text-on-inverse shadow-lg">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="space-y-1">
              <span className="inline-flex rounded-pill border border-inverse-border px-3 py-1 font-display text-xs font-bold uppercase tracking-[0.24em] text-primary">
                Ultimate Office Pool Manager
              </span>
              <h1 className="font-display text-2xl font-black tracking-normal text-on-inverse">
                Prime Time Commissioner
              </h1>
            </div>

            {shouldLoadLeagueShell ? (
              <>
                <LeagueSelector
                  activeLeagueCode={activeLeagueCode}
                  leagues={leaguesQuery.data ?? []}
                  onCreateLeague={openCreateLeague}
                  onNavigate={(path) => {
                    logger.info(
                      {
                        action: "appShell.league.navigate",
                        data: {
                          from: location.pathname,
                          to: path,
                        },
                      },
                      "Navigating to selected league from app shell",
                    );
                    navigate(path);
                  }}
                />
                <nav className="flex items-center gap-2" aria-label="Primary">
                  <AppNavigationMenu
                    className={appMenuClassName}
                    disabled={leagueMenuDisabled}
                    items={myTeamMenuItems}
                    label="My Team"
                    triggerTestId="app-menu-my-team-trigger"
                  />

                  <AppNavigationMenu
                    className={appMenuClassName}
                    contentClassName="min-w-60"
                    disabled={leagueMenuDisabled}
                    items={leagueMenuItems}
                    label="League"
                    triggerTestId="app-menu-league-trigger"
                  />
                </nav>
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {auth.isAuthenticated ? (
              <>
                <AppIconActionButton
                  className="border-inverse-border bg-on-inverse-subtle text-on-inverse-muted"
                  data-testid="app-shell-notifications"
                  disabled
                  icon={<Inbox aria-hidden size={18} />}
                  label="Notifications"
                  title="Notifications are not available yet."
                />
                <AccountMenu
                  isRootAdmin={auth.isRootAdmin}
                  profilePath={
                    auth.user?.id ? buildUserPath(auth.user.id) : "/"
                  }
                  userName={formatUserName(
                    auth.user?.firstName,
                    auth.user?.lastName,
                  )}
                  onLogout={async () => {
                    logger.info(
                      {
                        action: "appShell.logout.started",
                        data: {
                          userId: auth.user?.id ?? null,
                        },
                      },
                      "Started logout from the app shell",
                    );

                    await auth.clearSession();
                    navigate("/", { replace: true });
                    logger.info(
                      {
                        action: "appShell.logout.completed",
                        data: {
                          userId: auth.user?.id ?? null,
                        },
                      },
                      "Completed logout from the app shell",
                    );
                  }}
                />
              </>
            ) : (
              <div className="rounded-2xl border border-inverse-border bg-on-inverse-subtle px-4 py-3 text-sm text-on-inverse-muted">
                Current route:{" "}
                <span className="font-medium text-on-inverse">
                  {location.pathname}
                </span>
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
                action: "appShell.createLeagueModal.completed",
                data: {
                  leagueCode,
                },
              },
              "Created a league from the app shell modal",
            );
            navigate(buildCreateLeagueDestination(leagueCode), {
              replace: true,
            });
          }}
        />
      ) : null}
    </div>
  );
}
