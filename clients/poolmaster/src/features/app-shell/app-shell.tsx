import { useEffect } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
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
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@poolmaster/shared/domain";
import { StatusBadge } from "@/features/shared/ui";

/** The public How to Play page (#803): linked from the signed-out header and from every page's footer. */
const HOW_TO_PLAY_PATH = "/how-to-play";

/** The public Plans page (#973): linked beside How to Play in the signed-out header and the footer. */
const PLANS_PATH = "/plans";

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
      <header className="border-b-4 border-primary bg-surface-inverse text-on-inverse shadow-lg">
        {/* On a phone the title and account share the first row and the league selector takes
            the full second row, so the header never runs wider than the screen. */}
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-6 sm:py-5 lg:flex lg:justify-between">
          <div className="flex min-w-0 items-center gap-4 max-lg:contents">
            <div className="min-w-0 space-y-1">
              <StatusBadge className="hidden text-primary tracking-normal sm:inline-flex" tone="brandOutline">
                {PRODUCT_TAGLINE}
              </StatusBadge>
              <p className="font-display text-xl font-black uppercase italic tracking-normal text-on-inverse sm:text-2xl">
                {PRODUCT_NAME}
              </p>
            </div>

            {shouldLoadLeagueShell ? (
              <LeagueSelector
                activeLeagueCode={activeLeagueCode}
                className="col-span-2 sm:justify-self-start"
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
                  void navigate(path);
                }}
              />
            ) : null}
          </div>

          <div className="col-start-2 row-start-1 flex items-center justify-end gap-3">
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
                    void navigate("/", { replace: true });
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
              <>
                <Link
                  className="font-display text-sm font-bold uppercase tracking-button text-on-inverse hover:text-primary"
                  data-testid="app-shell-how-to-play"
                  to={HOW_TO_PLAY_PATH}
                >
                  How to Play
                </Link>
                <Link
                  className="font-display text-sm font-bold uppercase tracking-button text-on-inverse hover:text-primary"
                  data-testid="app-shell-plans"
                  to={PLANS_PATH}
                >
                  Plans
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {showLeagueMenu && activeLeagueCode ? <LeagueMenuBar leagueCode={activeLeagueCode} /> : null}

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <main>
          <Outlet />
        </main>
      </div>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-4 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <Link className="hover:text-foreground" data-testid="app-shell-footer-how-to-play" to={HOW_TO_PLAY_PATH}>
            How to Play
          </Link>
          <Link className="hover:text-foreground" data-testid="app-shell-footer-plans" to={PLANS_PATH}>
            Plans
          </Link>
        </div>
      </footer>

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
            void navigate(buildCreateLeagueDestination(leagueCode), {
              replace: true,
            });
          }}
        />
      ) : null}
    </div>
  );
}
