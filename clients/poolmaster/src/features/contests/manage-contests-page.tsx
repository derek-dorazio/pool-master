import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import {
  getLeagueByCode,
  listContests,
  type GetLeagueByCodeResponses,
  type ListContestsResponses,
} from '@/lib/api';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import {
  buildLeagueContestCreatePath,
  buildLeagueContestManagePath,
  buildLeagueContestPath,
  buildLeaguePath,
  setRecentLeagueCode,
} from '@/features/leagues/league-routing';
import { useLogger } from '@/lib/logger';
import { LinkButton, ListCard, ListEmptyRow, ListStack } from '@/features/shared/ui';
import { isHistoricalContest } from './contest-status';

type LeagueDetail = GetLeagueByCodeResponses[200]['league'];
type ContestSummary = ListContestsResponses[200]['contests'][number];

export function ManageContestsPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const logger = useLogger().child({
    feature: 'manage-contests-page',
  });

  const leagueQuery = useQuery({
    queryKey: ['poolmaster', 'league', leagueCode],
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
        action: 'manageContests.league.failed',
        data: {
          leagueCode,
        },
        err: leagueQuery.error,
      },
      'Manage Contests page failed to load league context',
    );
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const leagueId = leagueQuery.data?.id ?? '';
  const contestsQuery = useQuery({
    queryKey: ['poolmaster', 'league-contests', leagueId],
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

  if (leagueQuery.isLoading) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">Loading contest management...</p>
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

  const league = leagueQuery.data;
  const canManageContests = league.leagueRelationship.commissioner || league.isRootAdmin;

  if (!canManageContests) {
    return (
      <section className="space-y-6" data-testid="manage-contests-page">
        <div className="rounded-[2rem] border border-border bg-card p-8">
          <Link
            className="text-sm font-medium text-primary transition hover:opacity-80"
            to={buildLeaguePath(league.leagueCode)}
          >
            Back to League Home
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            Manage Contests
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
            Contest administration lives here for commissioners and root admins. This league
            membership does not include contest-management authority.
          </p>
        </div>

        <section
          className="rounded-[2rem] border border-border bg-card p-6"
          data-testid="manage-contests-access-denied"
        >
          <p className="text-sm text-muted-foreground">
            Open League Home for read-only league context. Contest management remains restricted to
            commissioners and root admins.
          </p>
          <Link
            className="mt-5 inline-flex items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
            to={buildLeaguePath(league.leagueCode)}
          >
            Open League Home
          </Link>
        </section>
      </section>
    );
  }

  const contests = contestsQuery.data ?? [];
  const activeContests = contests.filter((contest) => !isHistoricalContest(contest.status));
  const historicalContests = contests.filter((contest) => isHistoricalContest(contest.status));

  return (
    <section className="space-y-6" data-testid="manage-contests-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <Link
          className="text-sm font-medium text-primary transition hover:opacity-80"
          to={buildLeaguePath(league.leagueCode)}
        >
          Back to League Home
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Manage Contests
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              Commissioners and root admins manage league contests here. Use this list to open a
              contest, jump into the existing per-contest manage flow, or create the next contest.
            </p>
          </div>
          {league.isActive ? (
            <Link
              className="inline-flex items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              data-testid="manage-contests-create-link"
              to={buildLeagueContestCreatePath(league.leagueCode)}
            >
              Create Contest
            </Link>
          ) : (
            <div className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
              League inactive
            </div>
          )}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-background px-4 py-4">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">League</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{league.name}</div>
          </div>
          <div className="rounded-2xl bg-background px-4 py-4">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Active</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{activeContests.length}</div>
          </div>
          <div className="rounded-2xl bg-background px-4 py-4">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Historical</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{historicalContests.length}</div>
          </div>
        </div>
      </div>

      {contestsQuery.isLoading ? (
        <section className="rounded-[2rem] border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">Loading contests...</p>
        </section>
      ) : contestsQuery.isError ? (
        <section className="rounded-[2rem] border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load contests for this league.
          </p>
        </section>
      ) : !contests.length ? (
        <section
          className="rounded-[2rem] border border-border bg-card p-6"
          data-testid="manage-contests-empty"
        >
          <h2 className="text-xl font-semibold text-foreground">No contests yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Create the first contest for this league to start the commissioner workflow.
          </p>
          {league.isActive ? (
            <Link
              className="mt-5 inline-flex items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
              to={buildLeagueContestCreatePath(league.leagueCode)}
            >
              Create first contest
            </Link>
          ) : null}
        </section>
      ) : (
        <>
          <section className="rounded-[2rem] border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Active contests</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Open live contests or jump into the existing per-contest manage page.
                </p>
              </div>
              <div className="rounded-2xl bg-background px-4 py-2 text-sm font-medium text-foreground">
                {activeContests.length}
              </div>
            </div>

            <ListStack className="mt-5">
              {activeContests.length ? (
                activeContests.map((contest) => (
                  <ListCard
                    actions={
                      <>
                        <LinkButton
                          data-testid={`manage-contests-open-${contest.id}`}
                          to={buildLeagueContestPath(league.leagueCode, contest.id)}
                          variant="secondary"
                        >
                          Open contest
                        </LinkButton>
                        <LinkButton
                          data-testid={`manage-contests-manage-${contest.id}`}
                          to={buildLeagueContestManagePath(league.leagueCode, contest.id)}
                        >
                          Manage contest
                        </LinkButton>
                      </>
                    }
                    data-testid={`manage-contests-row-${contest.id}`}
                    metadata={`${contest.selectionType} · ${contest.scoringEngine} · ${contest.status}`}
                    key={contest.id}
                    title={contest.name}
                    trailing={
                      <>
                        <div>{contest.entryCount ?? 0} entries</div>
                        <div>{contest.sport}</div>
                      </>
                    }
                  />
                ))
              ) : (
                <ListEmptyRow>No active contests right now.</ListEmptyRow>
              )}
            </ListStack>
          </section>

          <section className="rounded-[2rem] border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Historical contests</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Completed and cancelled contests stay available here for review and per-contest
                  maintenance.
                </p>
              </div>
              <div className="rounded-2xl bg-background px-4 py-2 text-sm font-medium text-foreground">
                {historicalContests.length}
              </div>
            </div>

            <ListStack className="mt-5">
              {historicalContests.length ? (
                historicalContests.map((contest) => (
                  <ListCard
                    actions={
                      <>
                        <LinkButton
                          data-testid={`manage-contests-open-${contest.id}`}
                          to={buildLeagueContestPath(league.leagueCode, contest.id)}
                          variant="secondary"
                        >
                          Open contest
                        </LinkButton>
                        <LinkButton
                          data-testid={`manage-contests-manage-${contest.id}`}
                          to={buildLeagueContestManagePath(league.leagueCode, contest.id)}
                          variant="secondary"
                        >
                          Manage contest
                        </LinkButton>
                      </>
                    }
                    data-testid={`manage-contests-row-${contest.id}`}
                    metadata={`${contest.selectionType} · ${contest.scoringEngine} · ${contest.status}`}
                    key={contest.id}
                    title={contest.name}
                    trailing={
                      <>
                        <div>{contest.entryCount ?? 0} entries</div>
                        <div>{contest.sport}</div>
                      </>
                    }
                  />
                ))
              ) : (
                <ListEmptyRow>
                  Historical contests will appear here once this league has completed events.
                </ListEmptyRow>
              )}
            </ListStack>
          </section>
        </>
      )}
    </section>
  );
}
