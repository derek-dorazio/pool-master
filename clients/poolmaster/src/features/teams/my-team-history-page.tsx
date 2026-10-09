import { useQuery } from '@tanstack/react-query';
import { throwApiError } from '@/lib/errors';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { listContestEntries, type ContestEntryDto, type ContestEntryListResponse } from '@/lib/api';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import {
  buildLeagueContestEntryPath,
  buildLeagueContestPath,
  buildLeagueTeamPath,
} from '@/features/leagues/league-routing';
import { getLogger } from '@/lib/logger';
import { contestStatusLabel, isHistoricalContest } from '@/features/contests/contest-status';
import { QueryKeys } from '@/lib/query-keys';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import {
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingState,
  Tile,
} from '@/features/shared/ui';
import { useLeagueSquadsQuery } from './use-league-squads-query';
import { useLeagueContestsQuery } from '@/features/contests/use-league-contests-query';


export function MyTeamHistoryPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const logger = getLogger().child({
    feature: 'my-team-history-page',
  });

  // #202 — one league-context call, shared. Carries the viewer's own edges (A8).
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);


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

  const leagueId = league?.id ?? '';

  const teamsQuery = useLeagueSquadsQuery(leagueId);

  const contestsQuery = useLeagueContestsQuery(leagueId);

  // #202 (A8) — the viewer's own squad is named by their squad membership, which the league
  // context delivers once. This used to scan every squad in the league and every squad's member
  // list for the signed-in user, which is the same read A8 replaced — just written by hand
  // rather than as a per-row flag, which is why the type change did not catch it.
  const myTeam = useMemo(() => {
    if (!viewer.mySquadId) {
      return null;
    }

    return teamsQuery.data?.find((team) => team.id === viewer.mySquadId) ?? null;
  }, [teamsQuery.data, viewer.mySquadId]);

  const contestEntriesByContestQuery = useQuery({
    queryKey: QueryKeys.myTeamHistory.byTeamAndContests(
      myTeam?.id,
      contestsQuery.data?.map((contest) => contest.id).join(','),
    ),
    queryFn: async (): Promise<Record<string, ContestEntryListResponse>> => {
      if (!myTeam || !contestsQuery.data) {
        return {};
      }

      const results = await Promise.all(
        contestsQuery.data.map(async (contest) => {
          const response = await listContestEntries({ path: { contestId: contest.id } });

          if (!response.data) {
            throwApiError(response.error, 'Contest entries response is missing data.');
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
      <LoadingState
        body="Loading your contest history..."
        testId="my-team-history-loading"
      />
    );
  }

  if (leagueQuery.isError || !league) {
    const copy = getLeagueLoadErrorCopy(leagueQuery.error);

    return (
      <ErrorState
        action={<LinkButton to="/welcome" variant="secondary">Back to welcome</LinkButton>}
        body={copy.body}
        testId="my-team-history-league-error"
        title={copy.title}
      />
    );
  }

  const teamPath = buildLeagueTeamPath(leagueCode);

  return (
    <section className="space-y-6" data-testid="my-team-history-page">
      <Tile padding="lg">
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
      </Tile>

      <Tile>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Historical entries</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Completed contests stay visible here, but only with this team&apos;s
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
            <LoadingState
              body="Loading contest history..."
              testId="my-team-history-entries-loading"
            />
          ) : teamsQuery.isError || contestsQuery.isError || contestEntriesByContestQuery.isError ? (
            <ErrorState
              body="We couldn't load historical contests right now."
              testId="my-team-history-entries-error"
              title="History unavailable"
            />
          ) : !myTeam ? (
            <EmptyState
              action={<LinkButton to={teamPath} variant="secondary">Open My Team</LinkButton>}
              body="Create your team first and contest history will appear here."
              testId="my-team-history-no-team"
              title="No team yet"
            />
          ) : historicalContestCards.length === 0 ? (
            <EmptyState
              body="This team does not have any historical contest entries yet."
              testId="my-team-history-empty"
              title="No contest history yet"
            />
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
                      {contest.selectionType} · {contest.scoringEngine} · {contestStatusLabel(contest.status)}
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
                  {teamEntries.map((entry: ContestEntryDto) => (
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
      </Tile>
    </section>
  );
}
