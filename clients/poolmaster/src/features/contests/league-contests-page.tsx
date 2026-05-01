import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useMemo } from "react";
import {
  getMyContestEntry,
  getLeagueByCode,
  listContests,
  type GetLeagueByCodeResponses,
  type ListContestsResponses,
} from "@/lib/api";
import { getLeagueLoadErrorCopy } from "@/features/leagues/league-load-error";
import {
  buildLeagueContestCreatePath,
  buildLeagueContestsManagePath,
  buildLeaguePath,
  setRecentLeagueCode,
} from "@/features/leagues/league-routing";
import { useLogger } from "@/lib/logger";
import {
  Chip,
  EmptyState,
  ErrorState,
  LinkButton,
  ListStack,
  LoadingState,
  MetricGrid,
  MetricTile,
  PageHeader,
  Tile,
} from "@/features/shared/ui";
import { isHistoricalContest } from "./contest-status";
import { ContestListCard } from "./contest-list-card";

type LeagueDetail = GetLeagueByCodeResponses[200]["league"];
type ContestSummary = ListContestsResponses[200]["contests"][number];

export function LeagueContestsPage() {
  const { leagueCode = "" } = useParams<{ leagueCode: string }>();
  const [searchParams] = useSearchParams();
  const logger = useLogger().child({
    feature: "league-contests-page",
  });
  const isMyEntriesFilter = searchParams.get("filter") === "my-entries";

  const leagueQuery = useQuery({
    queryKey: ["poolmaster", "league", leagueCode],
    queryFn: async (): Promise<LeagueDetail> => {
      const response = await getLeagueByCode({ path: { leagueCode } });

      if (!response.data?.league) {
        throw (
          response.error ?? new Error("League detail response is missing data.")
        );
      }

      return response.data.league;
    },
    enabled: Boolean(leagueCode),
    retry: false,
  });

  useEffect(() => {
    if (leagueQuery.data?.leagueCode) {
      setRecentLeagueCode(leagueQuery.data.leagueCode);
    }
  }, [leagueQuery.data?.leagueCode]);

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

  const leagueId = leagueQuery.data?.id ?? "";
  const contestsQuery = useQuery({
    queryKey: ["poolmaster", "league-contests", leagueId],
    queryFn: async (): Promise<ContestSummary[]> => {
      const response = await listContests({ path: { id: leagueId } });

      if (!response.data?.contests) {
        throw (
          response.error ?? new Error("Contest list response is missing data.")
        );
      }

      return response.data.contests;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const contests = contestsQuery.data ?? [];
  const activeContests = useMemo(
    () => contests.filter((contest) => !isHistoricalContest(contest.status)),
    [contests],
  );
  const activeContestIds = useMemo(
    () => activeContests.map((contest) => contest.id),
    [activeContests],
  );
  const myContestIdsQuery = useQuery({
    queryKey: [
      "poolmaster",
      "league-contests",
      leagueId,
      "my-entries",
      activeContestIds,
    ],
    queryFn: async (): Promise<Set<string>> => {
      const contestIds = await Promise.all(
        activeContestIds.map(async (contestId) => {
          const response = await getMyContestEntry({ path: { contestId } });
          return response.data?.entry ? contestId : null;
        }),
      );

      return new Set(
        contestIds.filter((contestId): contestId is string =>
          Boolean(contestId),
        ),
      );
    },
    enabled: Boolean(leagueId && isMyEntriesFilter && activeContestIds.length),
    retry: false,
  });
  const visibleActiveContests = useMemo(() => {
    if (!isMyEntriesFilter) {
      return activeContests;
    }

    const myContestIds = myContestIdsQuery.data ?? new Set<string>();
    return activeContests.filter((contest) => myContestIds.has(contest.id));
  }, [activeContests, isMyEntriesFilter, myContestIdsQuery.data]);

  if (leagueQuery.isLoading) {
    return <LoadingState body="Loading league contests..." />;
  }

  if (leagueQuery.isError || !leagueQuery.data) {
    const copy = getLeagueLoadErrorCopy(leagueQuery.error);

    return (
      <ErrorState
        action={
          <Link
            className="inline-flex text-sm font-medium text-primary hover:underline"
            to="/welcome"
          >
            Back to welcome
          </Link>
        }
        body={copy.body}
        title={copy.title}
      />
    );
  }

  const league = leagueQuery.data;
  const canManageContests =
    league.leagueRelationship.commissioner || league.isRootAdmin;

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
        breadcrumbs={[
          { href: buildLeaguePath(league.leagueCode), label: "League Home" },
          { label: isMyEntriesFilter ? "My Contests" : "Active Contests" },
        ]}
        description={
          isMyEntriesFilter
            ? "Open active contests where your team has an entry."
            : "Open active contests and jump into contest boards from one place."
        }
        title={isMyEntriesFilter ? "My Contests" : "Active Contests"}
      />

      <MetricGrid>
        <MetricTile label="League" value={league.name} />
        <MetricTile label="Active" value={activeContests.length} />
        <MetricTile label="Shown" value={visibleActiveContests.length} />
      </MetricGrid>

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
            {isMyEntriesFilter && myContestIdsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Loading your contests...
              </p>
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
