import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
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
import {
  Chip,
  EmptyState,
  ErrorState,
  LinkButton,
  ListCard,
  ListEmptyRow,
  ListStack,
  LoadingState,
  MetricGrid,
  MetricTile,
  PageHeader,
  Tile,
} from '@/features/shared/ui';
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
    return <LoadingState body="Loading contest management..." />;
  }

  if (leagueQuery.isError || !leagueQuery.data) {
    const copy = getLeagueLoadErrorCopy(leagueQuery.error);

    return (
      <ErrorState
        action={(
          <LinkButton to="/welcome" variant="secondary">
            Back to welcome
          </LinkButton>
        )}
        body={copy.body}
        title={copy.title}
      />
    );
  }

  const league = leagueQuery.data;
  const canManageContests = league.leagueRelationship.commissioner || league.isRootAdmin;

  if (!canManageContests) {
    return (
      <section className="space-y-6" data-testid="manage-contests-page">
        <PageHeader
          breadcrumbs={[
            { href: buildLeaguePath(league.leagueCode), label: 'League Home' },
            { label: 'Manage Contests' },
          ]}
          description={(
            <>
            Contest administration lives here for commissioners and root admins. This league
            membership does not include contest-management authority.
            </>
          )}
          title="Manage Contests"
        />

        <EmptyState
          action={(
            <LinkButton to={buildLeaguePath(league.leagueCode)} variant="secondary">
              Open League Home
            </LinkButton>
          )}
          body="Open League Home for read-only league context. Contest management remains restricted to commissioners and root admins."
          testId="manage-contests-access-denied"
        />
      </section>
    );
  }

  const contests = contestsQuery.data ?? [];
  const activeContests = contests.filter((contest) => !isHistoricalContest(contest.status));
  const historicalContests = contests.filter((contest) => isHistoricalContest(contest.status));

  return (
    <section className="space-y-6" data-testid="manage-contests-page">
      <PageHeader
        actions={
          league.isActive ? (
            <LinkButton
              data-testid="manage-contests-create-link"
              to={buildLeagueContestCreatePath(league.leagueCode)}
            >
              Create Contest
            </LinkButton>
          ) : (
            <Chip tone="inactive">League inactive</Chip>
          )
        }
        breadcrumbs={[
          { href: buildLeaguePath(league.leagueCode), label: 'League Home' },
          { label: 'Manage Contests' },
        ]}
        description="Commissioners and root admins manage league contests here. Use this list to open a contest, jump into the existing per-contest manage flow, or create the next contest."
        title="Manage Contests"
      />

      <MetricGrid>
        <MetricTile label="League" value={league.name} />
        <MetricTile label="Active" value={activeContests.length} />
        <MetricTile label="Historical" value={historicalContests.length} />
      </MetricGrid>

      {contestsQuery.isLoading ? (
        <LoadingState body="Loading contests..." />
      ) : contestsQuery.isError ? (
        <ErrorState body="We couldn't load contests for this league." />
      ) : !contests.length ? (
        <EmptyState
          action={
            league.isActive ? (
              <LinkButton to={buildLeagueContestCreatePath(league.leagueCode)} variant="secondary">
                Create first contest
              </LinkButton>
            ) : null
          }
          body="Create the first contest for this league to start the commissioner workflow."
          testId="manage-contests-empty"
          title="No contests yet"
        />
      ) : (
        <>
          <Tile>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Active contests</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Open live contests or jump into the existing per-contest manage page.
                </p>
              </div>
              <Chip tone="neutral">{activeContests.length}</Chip>
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
          </Tile>

          <Tile>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Historical contests</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Completed and cancelled contests stay available here for review and per-contest
                  maintenance.
                </p>
              </div>
              <Chip tone="neutral">{historicalContests.length}</Chip>
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
          </Tile>
        </>
      )}
    </section>
  );
}
