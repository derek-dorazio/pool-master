import { useParams, useSearchParams } from 'react-router';
import { useEffect } from 'react';
import { ChampionshipContestList } from '@/features/championships/championship-contest-list';
import { useChampionshipContestsQuery } from '@/features/championships/use-championship-query';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import {
  Chip,
  EmptyState,
  ErrorState,
  Heading,
  LinkButton,
  LoadingState,
  PageHeader,
  Select,
  Tile,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { chooseContestHistoryYear } from './contest-history';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { ContestsViewSwitch } from './contests-view-switch';
import { useContestFinishedYearsQuery } from './use-league-contests-query';


/**
 * Contest History (#837): one year's completed contests at a time, newest first, each with its
 * winner. The year is in the link (`?year=2025`); without one, the newest year with a final contest.
 */
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
  const yearsQuery = useContestFinishedYearsQuery(leagueId);

  const [searchParams, setSearchParams] = useSearchParams();
  const years = yearsQuery.data ?? [];
  const year = chooseContestHistoryYear(years, searchParams.get('year'));
  const resultsQuery = useChampionshipContestsQuery(leagueId, year, null);

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

      {yearsQuery.isLoading ? (
        <LoadingState body="Loading contest history..." />
      ) : yearsQuery.isError ? (
        <ErrorState body="We couldn't load contest history for this league." />
      ) : year === null ? (
        <EmptyState body="This league does not have any completed contests yet." />
      ) : (
        <Tile data-testid="league-contests-history">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <Heading level={2} variant="card" size="xl">Completed in {year}</Heading>
              <p className="mt-2 text-sm text-muted-foreground">
                Open a completed contest to view final standings and revealed picks.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* poolmaster-allow-list-lookup: counts the results listed right below it */}
              {resultsQuery.data ? <Chip tone="info">{resultsQuery.data.length}</Chip> : null}
              <Select
                aria-label="Year"
                className="w-auto"
                data-testid="league-contests-history-year"
                onChange={(event) => setSearchParams({ year: event.target.value }, { replace: true })}
                value={year}
              >
                {years.map((option) => <option key={option} value={option}>{option}</option>)}
              </Select>
            </div>
          </div>

          <div className="mt-5">
            {resultsQuery.isError ? (
              <ErrorState body={`We couldn't load the contests completed in ${year}.`} testId="league-contests-history-error" />
            ) : !resultsQuery.data ? (
              <LoadingState body="Loading contest history..." />
            ) : (
              <ChampionshipContestList
                contestPath={buildLeagueContestPath}
                contests={resultsQuery.data}
                emptyBody={`No contest was completed in ${year}.`}
                leagueCode={league.leagueCode}
                testIdPrefix="league-history-contest"
              />
            )}
          </div>
        </Tile>
      )}
    </section>
  );
}
