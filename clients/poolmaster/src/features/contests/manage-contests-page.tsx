import { useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import {
  buildLeagueContestCreatePath,
  buildLeagueContestManagePath,
  buildLeagueContestPath,
  buildLeaguePath,
} from '@/features/leagues/league-routing';
import { getLogger } from '@/lib/logger';
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
import { contestStatusLabel, isHistoricalContest } from './contest-status';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { useLeagueContestsQuery } from './use-league-contests-query';


export function ManageContestsPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const logger = getLogger().child({
    feature: 'manage-contests-page',
  });

  // #202 — one league-context call, shared. Carries the viewer's own edges (A8).
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);


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

  const leagueId = league?.id ?? '';
  const contestsQuery = useLeagueContestsQuery(leagueId);

  if (leagueQuery.isLoading) {
    return <LoadingState body="Loading contest management..." />;
  }

  if (leagueQuery.isError || !league) {
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

  const canManageContests = viewer.isCommissioner || viewer.isRootAdmin;

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
            Only commissioners can manage contests.
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
          body="Ask a commissioner if a contest needs changing."
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
        description="Open, manage, or create contests for this league."
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
          body="Create the first contest for this league."
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
                  Contests that are in setup, open, or under way.
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
                    metadata={`${contest.selectionType} · ${contest.scoringEngine} · ${contestStatusLabel(contest.status)}`}
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
                  Completed contests.
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
                    metadata={`${contest.selectionType} · ${contest.scoringEngine} · ${contestStatusLabel(contest.status)}`}
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
