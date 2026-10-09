import { useParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
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
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { ContestsViewSwitch } from './contests-view-switch';
import { useLeagueContestsQuery } from './use-league-contests-query';


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
  const contestsQuery = useLeagueContestsQuery(leagueId);

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
        actions={<ContestsViewSwitch leagueCode={league.leagueCode} value="history" />}
        description="Completed contests, with final standings and revealed picks."
        title="Contests"
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
