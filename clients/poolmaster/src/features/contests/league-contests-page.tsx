import { useParams, useSearchParams } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { useLeagueContextGuard } from "@/features/leagues/league-context-guard";
import {
  buildLeagueContestCreatePath,
  buildLeagueContestsManagePath,
} from "@/features/leagues/league-routing";
import { getLogger } from "@/lib/logger";
import {
  Chip,
  EmptyState,
  ErrorState,
  LinkButton,
  ListStack,
  LoadingState,
  PageHeader,
  Tile,
} from "@/features/shared/ui";
import { isHistoricalContest } from "./contest-status";
import { ContestListCard } from "./contest-list-card";
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { ContestsViewSwitch } from './contests-view-switch';
import { useMyContestEntries } from './use-contest-entries';
import { useLeagueContestsQuery } from './use-league-contests-query';


export function LeagueContestsPage() {
  const { leagueCode = "" } = useParams<{ leagueCode: string }>();
  const [searchParams] = useSearchParams();
  const logger = getLogger().child({
    feature: "league-contests-page",
  });
  const isMyEntriesFilter = searchParams.get("filter") === "my-entries";

  // #202 — one league-context call, shared. Carries the viewer's own edges (A8).
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);


  useEffect(() => {
    if (!leagueQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: "leagueContests.league.failed",
        data: {
          leagueCode,
        },
        err: leagueQuery.error,
      },
      "League Contests page failed to load league context",
    );
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const leagueId = league?.id ?? "";
  const contestsQuery = useLeagueContestsQuery(leagueId);

  const contests = useMemo(() => contestsQuery.data ?? [], [contestsQuery.data]);
  const activeContests = useMemo(
    () => contests.filter((contest) => !isHistoricalContest(contest.status)),
    [contests],
  );
  const activeContestIds = useMemo(
    () => activeContests.map((contest) => contest.id),
    [activeContests],
  );
  const myEntries = useMyContestEntries(
    isMyEntriesFilter ? activeContestIds : [],
    viewer.mySquadId,
  );
  useEffect(() => {
    if (!myEntries.isError) {
      return;
    }

    logger.warn(
      {
        action: "leagueContests.myEntries.failed",
        data: {
          leagueCode,
        },
      },
      "League Contests page failed to load the team's contest entries",
    );
  }, [leagueCode, myEntries.isError, logger]);
  const visibleActiveContests = useMemo(() => {
    if (!isMyEntriesFilter) {
      return activeContests;
    }

    return activeContests.filter(
      (contest) => (myEntries.entriesByContestId.get(contest.id)?.length ?? 0) > 0,
    );
  }, [activeContests, isMyEntriesFilter, myEntries.entriesByContestId]);
  const leagueContext = useLeagueContextGuard(leagueQuery, {
    loadingBody: "Loading league contests...",
  });

  // `!league` is unreachable once the guard reports ready — it is here so the league is
  // narrowed for everything below rather than threaded as `league?.` throughout.
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }


  const canManageContests =
    viewer.isCommissioner || viewer.isRootAdmin;

  return (
    <section className="space-y-6" data-testid="league-contests-page">
      <PageHeader
        actions={
          <>
            {canManageContests ? (
              <LinkButton
                to={buildLeagueContestsManagePath(league.leagueCode)}
                variant="secondary"
              >
                Manage Contests
              </LinkButton>
            ) : null}
            {canManageContests && league.isActive ? (
              <LinkButton to={buildLeagueContestCreatePath(league.leagueCode)}>
                Create Contest
              </LinkButton>
            ) : null}
          </>
        }
        description={
          isMyEntriesFilter
            ? "Active contests where your team has an entry."
            : "Active contests in this league."
        }
        title="Contests"
      />

      <ContestsViewSwitch
        leagueCode={league.leagueCode}
        value={isMyEntriesFilter ? "mine" : "active"}
      />

      {contestsQuery.isLoading ? (
        <LoadingState body="Loading contests..." />
      ) : contestsQuery.isError ? (
        <ErrorState body="We couldn't load contests for this league." />
      ) : (
        <Tile data-testid="league-contests-active">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                {isMyEntriesFilter ? "My active contests" : "Active contests"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Open a contest to view its leaderboard, manage entries, and see
                picks once the event has started.
              </p>
            </div>
            <Chip tone="info">
              {visibleActiveContests.length}
            </Chip>
          </div>

          <ListStack className="mt-5">
            {isMyEntriesFilter && myEntries.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Loading your contests...
              </p>
            ) : isMyEntriesFilter && myEntries.isError ? (
              <ErrorState body="We couldn't load your contests." />
            ) : visibleActiveContests.length ? (
              visibleActiveContests.map((contest) => (
                <ContestListCard
                  contest={contest}
                  key={contest.id}
                  leagueCode={league.leagueCode}
                  testId={`league-contest-${contest.id}`}
                />
              ))
            ) : (
              <EmptyState
                body={
                  isMyEntriesFilter
                    ? "Your team does not have entries in any active contests yet."
                    : "No active contests are available for this league yet."
                }
              />
            )}
          </ListStack>
        </Tile>
      )}
    </section>
  );
}
