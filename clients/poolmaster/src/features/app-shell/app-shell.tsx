import { ChevronDown, Inbox } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { ActionList, ActionTile, Button, Tile } from "@/features/shared/ui";
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
  const [openMenu, setOpenMenu] = useState<"my-team" | "league" | null>(null);
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

  function closeMenus() {
    setOpenMenu(null);
  }

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
                    closeMenus();
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
                  <div className="relative">
                    <Button
                      aria-expanded={openMenu === "my-team"}
                      className="border-inverse-border bg-on-inverse-subtle text-on-inverse hover:border-primary/50 hover:bg-on-inverse-hover disabled:text-on-inverse-muted"
                      data-testid="app-menu-my-team-trigger"
                      disabled={leagueMenuDisabled}
                      onClick={() =>
                        setOpenMenu((current) =>
                          current === "my-team" ? null : "my-team",
                        )
                      }
                      type="button"
                      variant="secondary"
                    >
                      My Team
                      <ChevronDown aria-hidden size={16} />
                    </Button>
                    {openMenu === "my-team" && activeLeagueCode ? (
                      <Tile
                        className="absolute left-0 top-full z-40 mt-2 min-w-56 shadow-xl"
                        padding="sm"
                        radius="lg"
                      >
                        <ActionList>
                          <ActionTile
                            data-testid="app-menu-my-team-details"
                            label="Team Details"
                            onClick={closeMenus}
                            to={buildLeagueTeamPath(activeLeagueCode)}
                          />
                          <ActionTile
                            data-testid="app-menu-my-contests"
                            label="My Contests"
                            onClick={closeMenus}
                            to={buildLeagueMyContestsPath(activeLeagueCode)}
                          />
                          <ActionTile
                            data-testid="app-menu-my-history"
                            label="My History"
                            onClick={closeMenus}
                            to={buildLeagueHistoryPath(activeLeagueCode)}
                          />
                        </ActionList>
                      </Tile>
                    ) : null}
                  </div>

                  <div className="relative">
                    <Button
                      aria-expanded={openMenu === "league"}
                      className="border-inverse-border bg-on-inverse-subtle text-on-inverse hover:border-primary/50 hover:bg-on-inverse-hover disabled:text-on-inverse-muted"
                      data-testid="app-menu-league-trigger"
                      disabled={leagueMenuDisabled}
                      onClick={() =>
                        setOpenMenu((current) =>
                          current === "league" ? null : "league",
                        )
                      }
                      type="button"
                      variant="secondary"
                    >
                      League
                      <ChevronDown aria-hidden size={16} />
                    </Button>
                    {openMenu === "league" && activeLeagueCode ? (
                      <Tile
                        className="absolute left-0 top-full z-40 mt-2 min-w-60 shadow-xl"
                        padding="sm"
                        radius="lg"
                      >
                        <ActionList>
                          <ActionTile
                            data-testid="app-menu-league-details"
                            label="League Details"
                            onClick={closeMenus}
                            to={buildLeaguePath(activeLeagueCode)}
                          />
                          <ActionTile
                            data-testid="app-menu-league-teams"
                            label="Teams and Owners"
                            onClick={closeMenus}
                            to={buildLeagueTeamsPath(activeLeagueCode)}
                          />
                          <ActionTile
                            data-testid="app-menu-active-contests"
                            label="Active Contests"
                            onClick={closeMenus}
                            to={buildLeagueContestsPath(activeLeagueCode)}
                          />
                          <ActionTile
                            data-testid="app-menu-contest-history"
                            label="Contest History"
                            onClick={closeMenus}
                            to={buildLeagueContestHistoryPath(activeLeagueCode)}
                          />
                          {canCreateActiveLeagueContest ? (
                            <ActionTile
                              data-testid="app-menu-create-contest"
                              label="Create Contest"
                              onClick={closeMenus}
                              to={buildLeagueContestCreatePath(
                                activeLeagueCode,
                              )}
                            />
                          ) : null}
                        </ActionList>
                      </Tile>
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
                  className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-inverse-border bg-on-inverse-subtle text-on-inverse-muted"
                  data-testid="app-shell-notifications"
                  disabled
                  title="Notifications are not available yet."
                  type="button"
                >
                  <Inbox aria-hidden size={18} />
                </button>
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
