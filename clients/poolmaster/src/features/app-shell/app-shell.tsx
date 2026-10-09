import { useEffect } from "react";
import {
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useAuth } from "@/features/auth/auth-context";
import { getLogger } from "@/lib/logger";
import { AccountMenu } from "@/features/account/account-menu";
import { buildUserPath } from "@/features/account/user-routing";
import { formatUserName } from "@/features/account/user-name";
import { CreateLeagueModal } from "@/features/leagues/create-league-modal";
import { buildCreateLeagueDestination } from "@/features/leagues/create-league-form";
import { buildLeagueAdminPath } from "@/features/leagues/league-routing";
import { LeagueMenuBar } from "@/features/leagues/league-menu-bar";
import { useLeaguesQuery } from "@/features/leagues/use-leagues-query";
import { LeagueSelector } from "./league-selector";

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { leagueCode } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAuth();
  const logger = getLogger().child({
    feature: "app-shell",
  });
  const isManageRoute =
    location.pathname === "/manage" || location.pathname.startsWith("/manage/");
  const shouldLoadLeagueShell =
    auth.isAuthenticated && !auth.isRootAdmin && !isManageRoute;
  const { query: leaguesQuery, leagues, commissionerLeagueIds } = useLeaguesQuery({
    enabled: shouldLoadLeagueShell,
  });
  const activeLeagueCode = leagueCode ?? null;
  const isCreateLeagueOpen = searchParams.get("createLeague") === "1";
  // Commissioner tools has its own area header, so the member menu stands down there.
  const isCommissionerToolsRoute = Boolean(
    activeLeagueCode
      && (location.pathname === buildLeagueAdminPath(activeLeagueCode)
        || location.pathname.startsWith(`${buildLeagueAdminPath(activeLeagueCode)}/`)),
  );
  const showLeagueMenu =
    auth.isAuthenticated && Boolean(activeLeagueCode) && !isCommissionerToolsRoute;

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
    if (!shouldLoadLeagueShell || !leagues) {
      return;
    }

    logger.info(
      {
        action: "appShell.loaded",
        data: {
          path: location.pathname,
          activeLeagueCode,
          leagueCount: leagues.length,
        },
      },
      "Loaded authenticated app shell state",
    );
  }, [
    activeLeagueCode,
    leagues,
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
              <span className="inline-flex rounded-pill border border-inverse-border px-3 py-1 font-display text-xs font-bold uppercase text-primary">
                Ultimate Office Pool Manager
              </span>
              <h1 className="font-display text-2xl font-black tracking-normal text-on-inverse">
                Prime Time Commissioner
              </h1>
            </div>

            {shouldLoadLeagueShell ? (
              <LeagueSelector
                activeLeagueCode={activeLeagueCode}
                commissionerLeagueIds={commissionerLeagueIds}
                leagues={leagues ?? []}
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
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {auth.isAuthenticated ? (
              <>
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
            ) : null}
          </div>
        </div>
      </header>

      {showLeagueMenu && activeLeagueCode ? <LeagueMenuBar leagueCode={activeLeagueCode} /> : null}

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
