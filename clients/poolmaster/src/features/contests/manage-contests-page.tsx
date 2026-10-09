import { useParams } from 'react-router-dom';
import {
  buildLeagueAdminContestCreatePath,
  buildLeagueAdminContestPath,
  buildLeagueContestPath,
} from '@/features/leagues/league-routing';
import {
  Chip,
  EmptyState,
  ErrorState,
  LinkButton,
  ListCard,
  ListEmptyRow,
  ListStack,
  LoadingState,
  PageHeader,
  Tile,
} from '@/features/shared/ui';
import { contestStatusLabel, isHistoricalContest } from './contest-status';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { useLeagueContestsQuery } from './use-league-contests-query';

/** Commissioner tools › Contests: every contest in the league, with Create contest. */
export function ManageContestsPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league } = useLeagueContext(leagueCode);
  const contestsQuery = useLeagueContestsQuery(league?.id ?? '');

  if (!league) {
    return null;
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
              to={buildLeagueAdminContestCreatePath(league.leagueCode)}
            >
              Create contest
            </LinkButton>
          ) : (
            <Chip tone="inactive">League inactive</Chip>
          )
        }
        description="Set up new contests and manage the ones already running."
        title="Contests"
      />

      {contestsQuery.isLoading ? (
        <LoadingState body="Loading contests..." />
      ) : contestsQuery.isError ? (
        <ErrorState body="We couldn't load contests for this league." />
      ) : !contests.length ? (
        <EmptyState
          action={
            league.isActive ? (
              <LinkButton to={buildLeagueAdminContestCreatePath(league.leagueCode)} variant="secondary">
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
                          to={buildLeagueAdminContestPath(league.leagueCode, contest.id)}
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
                          to={buildLeagueAdminContestPath(league.leagueCode, contest.id)}
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
