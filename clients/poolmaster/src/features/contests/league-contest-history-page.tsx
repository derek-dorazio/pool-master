import { useParams, useSearchParams } from 'react-router';
import { useEffect } from 'react';
import { ChampionshipContestList } from '@/features/championships/championship-contest-list';
import { SquadFinishShown } from '@/features/championships/championship-view';
import { useChampionshipContestsQuery } from '@/features/championships/use-championship-query';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import {
  Chip,
  ErrorState,
  LinkButton,
  LoadingState,
  SectionCard,
  SectionEmpty,
  YearPicker,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { chooseContestHistoryYear } from './contest-history';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { ContestsPageHeader } from './contests-page-header';
import { useContestFinishedYearsQuery } from './use-league-contests-query';

/**
 * Contest History (#837): one year's completed contests at a time, newest first, each with its
 * winner and the viewer's team's place (#1570). The year is in the link (`?year=2025`); without one, the newest year with a final contest.
 * `?focus={contestId}` tints and scrolls to the contest a contest page's breadcrumb came from.
 */
export function LeagueContestHistoryPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const logger = getLogger().child({
    feature: 'league-contest-history-page',
  });

  // #202 — one league-context call, shared. Carries the viewer's own edges (A8).
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);

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
  // #1570 — each row carries the viewer's team's finish, so the row shows their place.
  const resultsQuery = useChampionshipContestsQuery(leagueId, year, null, viewer.mySquadId);

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
        onRetry={() => void leagueQuery.refetch()}
        title={copy.title}
      />
    );
  }

  return (
    <section className="space-y-6" data-testid="league-contest-history-page">
      <ContestsPageHeader
        leagueCode={league.leagueCode}
        tabsEnd={year === null ? undefined : (
          <YearPicker
            onChange={(next) => setSearchParams({ year: String(next) }, { replace: true })}
            testId="league-contests-history-year"
            value={year}
            years={years}
          />
        )}
        view="past"
      />

      {yearsQuery.isLoading ? (
        <LoadingState rows={3} body="Loading contest history..." />
      ) : yearsQuery.isError ? (
        <ErrorState body="We couldn't load contest history for this league." onRetry={() => void yearsQuery.refetch()} />
      ) : year === null ? (
        <SectionCard testId="league-contests-history" title="Past contests">
          <SectionEmpty testId="league-contests-history-none">No completed contests yet.</SectionEmpty>
        </SectionCard>
      ) : (
        <SectionCard
          testId="league-contests-history"
          title={`Completed in ${year}`}
          // poolmaster-allow-list-lookup: counts the results listed right below it
          trailing={resultsQuery.data ? <Chip tone="info">{resultsQuery.data.length}</Chip> : null}
        >
          {resultsQuery.isError ? (
            <ErrorState body={`We couldn't load the contests completed in ${year}.`} onRetry={() => void resultsQuery.refetch()} size="inline" testId="league-contests-history-error" />
          ) : !resultsQuery.data ? (
            <LoadingState rows={3} body="Loading contest history..." size="inline" />
          ) : (
            <ChampionshipContestList
              contests={resultsQuery.data}
              emptyBody={`No contest was completed in ${year}.`}
              finishShown={SquadFinishShown.PLACE}
              focusContestId={searchParams.get('focus')}
              leagueCode={league.leagueCode}
              testIdPrefix="league-history-contest"
            />
          )}
        </SectionCard>
      )}
    </section>
  );
}
