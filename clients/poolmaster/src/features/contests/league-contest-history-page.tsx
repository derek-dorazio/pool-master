import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { listContests, type ContestDto } from '@/lib/api';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import { buildLeagueContestsPath, buildLeaguePath } from '@/features/leagues/league-routing';
import {
  Chip,
  EmptyState,
  ErrorState,
  LinkButton,
  ListStack,
  LoadingState,
  PageHeader,
  Tile,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { isHistoricalContest } from './contest-status';
import { ContestListCard } from './contest-list-card';
import { QueryKeys } from '@/lib/query-keys';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { throwApiError } from '@/lib/errors';


export function LeagueContestHistoryPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const logger = getLogger().child({
    feature: 'league-contest-history-page',
  });

  // #202 — one league-context call, shared. Carries the viewer's own edges (A8).
  const { query: leagueQuery, league } = useLeagueContext(leagueCode);


  useEffect(() => {
    if (!leagueQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'leagueContestHistory.league.failed',
        data: {
          leagueCode,
        },
        err: leagueQuery.error,
      },
      'League Contest History page failed to load league context',
    );
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const leagueId = league?.id ?? '';
  const contestsQuery = useQuery({
    queryKey: QueryKeys.contests.list({ leagueId }),
    queryFn: async (): Promise<ContestDto[]> => {
      const response = await listContests({ path: { id: leagueId } });

      if (!response.data?.contests) {
        throwApiError(response.error, 'Contest list response is missing data.');
      }

      return response.data.contests;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const historicalContests = useMemo(
    () => (contestsQuery.data ?? []).filter((contest) => isHistoricalContest(contest.status)),
    [contestsQuery.data],
  );

  if (leagueQuery.isLoading) {
    return <LoadingState body="Loading contest history..." />;
  }

  if (leagueQuery.isError || !league) {
    const copy = getLeagueLoadErrorCopy(leagueQuery.error);

    return (
      <ErrorState
        action={(
          <LinkButton to="/welcome" variant="subtle">
            Back to welcome
          </LinkButton>
        )}
        body={copy.body}
        title={copy.title}
      />
    );
  }


  return (
    <section className="space-y-6" data-testid="league-contest-history-page">
      <PageHeader
        actions={(
          <LinkButton to={buildLeaguePath(league.leagueCode)} variant="secondary">
            League Details
          </LinkButton>
        )}
        breadcrumbs={[
          { href: buildLeagueContestsPath(league.leagueCode), label: 'Active Contests' },
          { label: 'Contest History' },
        ]}
        description="Review completed contests, final standings, and revealed picks."
        title="Contest History"
      />

      {contestsQuery.isLoading ? (
        <LoadingState body="Loading contest history..." />
      ) : contestsQuery.isError ? (
        <ErrorState body="We couldn't load contest history for this league." />
      ) : (
        <Tile data-testid="league-contests-history">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Completed contests</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Open a completed contest to view final standings and revealed picks.
              </p>
            </div>
            <Chip tone="info">
              {historicalContests.length}
            </Chip>
          </div>

          <ListStack className="mt-5">
            {historicalContests.length ? (
              historicalContests.map((contest) => (
                <ContestListCard
                  contest={contest}
                  key={contest.id}
                  leagueCode={league.leagueCode}
                  testId={`league-history-contest-${contest.id}`}
                />
              ))
            ) : (
              <EmptyState body="This league does not have any completed contests yet." />
            )}
          </ListStack>
        </Tile>
      )}
    </section>
  );
}
