import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import {
  getLeagueByCode,
  listContestEntries,
  listContests,
  listLeagueSquads,
  type GetLeagueByCodeResponses,
  type ListContestEntriesResponses,
  type ListContestsResponses,
  type ListLeagueSquadsResponses,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import {
  buildLeagueContestEntryPath,
  buildLeagueContestPath,
  buildLeagueTeamPath,
  setRecentLeagueCode,
} from '@/features/leagues/league-routing';
import { getLogger } from '@/lib/logger';
import { isHistoricalContest } from '@/features/contests/contest-status';
import { QueryKeys } from '@/lib/query-keys';

type LeagueDetail = GetLeagueByCodeResponses[200]['league'];
type TeamSummary = ListLeagueSquadsResponses[200]['squads'][number];
type ContestSummary = ListContestsResponses[200]['contests'][number];
type ContestEntrySummary = ListContestEntriesResponses[200]['entries'][number];

export function MyTeamHistoryPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const auth = useAuth();
  const logger = getLogger().child({
    feature: 'my-team-history-page',
  });

  const leagueQuery = useQuery({
    queryKey: QueryKeys.leagues.detail(leagueCode),
    queryFn: async (): Promise<LeagueDetail> => {
      const response = await getLeagueByCode({ path: { leagueCode } });

      if (!response.data?.league) {
        throw response.error ?? new Error('League detail response is missing data.');
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
        action: 'myTeamHistory.league.failed',
        data: {
          leagueCode,
        },
        err: leagueQuery.error,
      },
      'My Team History page failed to load league context',
    );
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const leagueId = leagueQuery.data?.id ?? '';

  const teamsQuery = useQuery({
    queryKey: QueryKeys.leagueTeams.byLeague(leagueId),
    queryFn: async (): Promise<TeamSummary[]> => {
      const response = await listLeagueSquads({ path: { id: leagueId } });

      if (!response.data?.squads) {
        throw response.error ?? new Error('Team list response is missing data.');
      }

      return response.data.squads;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const contestsQuery = useQuery({
    queryKey: QueryKeys.contests.list({ leagueId }),
    queryFn: async (): Promise<ContestSummary[]> => {
      const response = await listContests({ path: { id: leagueId } });

      if (!response.data?.contests) {
        throw response.error ?? new Error('Contest list response is missing data.');
      }

      return response.data.contests;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const myTeam = useMemo(() => {
    if (!auth.user?.id) {
      return null;
    }

    return teamsQuery.data?.find((team) =>
      team.members?.some(
        (member) => member.userId === auth.user?.id && member.status === 'ACTIVE',
      ),
    ) ?? null;
  }, [auth.user?.id, teamsQuery.data]);

  const contestEntriesByContestQuery = useQuery({
    queryKey: QueryKeys.myTeamHistory.byTeamAndContests(
      myTeam?.id,
      contestsQuery.data?.map((contest) => contest.id).join(','),
    ),
    queryFn: async (): Promise<Record<string, ListContestEntriesResponses[200]>> => {
      if (!myTeam || !contestsQuery.data) {
        return {};
      }

      const results = await Promise.all(
        contestsQuery.data.map(async (contest) => {
          const response = await listContestEntries({ path: { contestId: contest.id } });

          if (!response.data) {
            throw response.error ?? new Error('Contest entries response is missing data.');
          }

          return [contest.id, response.data] as const;
        }),
      );

      return Object.fromEntries(results);
    },
    enabled: Boolean(myTeam && contestsQuery.data),
    retry: false,
  });

  const historicalContestCards = useMemo(() => {
    if (!myTeam || !contestsQuery.data) {
      return [];
    }

    return contestsQuery.data
      .filter((contest) => isHistoricalContest(contest.status))
      .map((contest) => {
        const entryResponse = contestEntriesByContestQuery.data?.[contest.id];
        const teamEntries = (entryResponse?.entries ?? []).filter((entry) => entry.squadId === myTeam.id);

        return {
          contest,
          teamEntries,
        };
      })
      .filter(({ teamEntries }) => teamEntries.length > 0);
  }, [contestEntriesByContestQuery.data, contestsQuery.data, myTeam]);

  if (leagueQuery.isLoading) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">Loading your contest history...</p>
      </section>
    );
  }

  if (leagueQuery.isError || !leagueQuery.data) {
    const copy = getLeagueLoadErrorCopy(leagueQuery.error);

    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <h2 className="text-2xl font-semibold">{copy.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
        <Link
          className="mt-4 inline-flex text-sm font-medium text-primary hover:underline"
          to="/welcome"
        >
          Back to welcome
        </Link>
      </section>
    );
  }

  const teamPath = buildLeagueTeamPath(leagueCode);

  return (
    <section className="space-y-6" data-testid="my-team-history-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <Link
          className="text-sm font-medium text-primary transition hover:opacity-80"
          to={teamPath}
        >
          Back to My Team
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          My Contest History
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          View completed contests and previous results for your team.
        </p>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Historical entries</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Completed and cancelled contests stay visible here, but only with this team&apos;s
              entries.
            </p>
          </div>
          {myTeam ? (
            <div className="rounded-2xl bg-background px-4 py-2 text-sm font-medium text-foreground">
              {myTeam.name}
            </div>
          ) : null}
        </div>

        <div className="mt-5 space-y-3">
          {teamsQuery.isLoading || contestsQuery.isLoading || (myTeam && contestEntriesByContestQuery.isLoading) ? (
            <p className="text-sm text-muted-foreground">Loading contest history...</p>
          ) : teamsQuery.isError || contestsQuery.isError || contestEntriesByContestQuery.isError ? (
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t load historical contests right now.
            </p>
          ) : !myTeam ? (
            <div className="rounded-[1.5rem] border border-border bg-background p-5">
              <p className="text-sm text-muted-foreground">
                Create your team first and contest history will appear here.
              </p>
              <Link
                className="mt-4 inline-flex rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
                to={teamPath}
              >
                Open My Team
              </Link>
            </div>
          ) : historicalContestCards.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This team does not have any historical contest entries yet.
            </p>
          ) : (
            historicalContestCards.map(({ contest, teamEntries }) => (
              <div
                className="rounded-[1.5rem] border border-border bg-background p-4"
                data-testid={`my-team-history-contest-${contest.id}`}
                key={contest.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-foreground">{contest.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {contest.selectionType} · {contest.scoringEngine} · {contest.status}
                    </div>
                  </div>
                  <Link
                    className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-foreground"
                    data-testid={`my-team-history-open-contest-${contest.id}`}
                    to={buildLeagueContestPath(leagueCode, contest.id)}
                  >
                    Open contest
                  </Link>
                </div>

                <div className="mt-4 space-y-3">
                  {teamEntries.map((entry: ContestEntrySummary) => (
                    <div
                      className="rounded-2xl border border-border bg-card px-4 py-4"
                      data-testid={`my-team-history-entry-${entry.id}`}
                      key={entry.id}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="font-medium text-foreground">{entry.name}</div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {entry.squadName} · Entry {entry.entryNumber}
                          </div>
                        </div>
                        <div className="text-right text-sm text-muted-foreground">
                          <div>{entry.standingsPosition ? `#${entry.standingsPosition}` : 'Rank pending'}</div>
                          <div>{entry.totalScore} pts</div>
                        </div>
                      </div>
                      <div className="mt-4">
                        <Link
                          className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground"
                          data-testid={`my-team-history-entry-open-${entry.id}`}
                          state={{ leagueCode }}
                          to={buildLeagueContestEntryPath(leagueCode, contest.id, entry.id)}
                        >
                          View entry detail
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </section>
  );
}
