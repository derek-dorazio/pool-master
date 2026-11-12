import { PlanFeature } from '@poolmaster/shared/domain';
import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import {
  buildLeagueChampionshipsPath,
  buildLeaguePointsRacePath,
} from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import {
  ErrorState,
  LoadingState,
  MetricGrid,
  MetricTile,
  SectionCard,
  SectionEmpty,
  SectionRow,
  SectionRows,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { PlanLockedNotice } from '@/features/plans/plan-locked-notice';
import { ChampionshipsHeader } from './championships-header';
import { joinNames } from './cup-view';
import { RecordBook } from './record-book';
import {
  SUMMARY_TILE_LABELS,
  describeHistoryChampions,
  describeHistoryCup,
  historyYearTitle,
  historyYearsOnShow,
} from './championship-view';
import { useHistorySummaryQuery } from './use-championship-query';

/**
 * All years (#837, mockup C), the Championships header's All years tab (#1543): tiles for the
 * most championships and cups won, the record book (#873), then each year newest first with its
 * champion and cup champions ("2026 so far" while the year runs). A year opens that year's
 * Championship tab; a cup opens its Points race. The summary and the record book each show the
 * locked note on a plan without them (#948).
 */
export function AllYearsPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const logger = useMemo(() => getLogger().child({ feature: 'all-years-page' }), []);
  const { league, query: leagueQuery, viewer } = useLeagueContext(leagueCode);
  const hasSummary = hasPlanFeature(league, PlanFeature.ALL_TIME_SUMMARY);
  const summaryQuery = useHistorySummaryQuery(hasSummary ? league?.id ?? '' : '');

  useEffect(() => {
    if (leagueQuery.isError) {
      logger.warn(
        { action: 'allYears.league.failed', data: { leagueCode }, err: leagueQuery.error },
        'All years failed to load league context',
      );
    }
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const leagueContext = useLeagueContextGuard(leagueQuery, { loadingBody: 'Loading league history...' });
  if (leagueContext.state === 'blocked') {
    return leagueContext.element;
  }
  const years = summaryQuery.data ? historyYearsOnShow(summaryQuery.data.years) : [];
  const recordBook = hasPlanFeature(league, PlanFeature.RECORD_BOOK)
    ? <RecordBook leagueId={league?.id ?? ''} />
    : <PlanLockedNotice feature={PlanFeature.RECORD_BOOK} isCommissioner={viewer.isCommissioner} leagueCode={leagueCode} />;

  return (
    <section className="space-y-6" data-testid="all-years-page">
      <ChampionshipsHeader leagueCode={leagueCode} tab="allYears" title="All years" />
      {!hasSummary ? (
        <>
          <PlanLockedNotice feature={PlanFeature.ALL_TIME_SUMMARY} isCommissioner={viewer.isCommissioner} leagueCode={leagueCode} />
          {recordBook}
        </>
      ) : summaryQuery.isError ? (
        <ErrorState body="We couldn't load the league's history." onRetry={() => void summaryQuery.refetch()} testId="all-years-error" />
      ) : !summaryQuery.data ? (
        <LoadingState body="Loading league history..." />
      ) : (
        <>
          <MetricGrid>
            {summaryQuery.data.tiles.map((tile) => (
              <div data-testid={`all-years-tile-${tile.tile}`} key={tile.tile}>
                <MetricTile
                  helperText={tile.squads.length ? joinNames(tile.squads.map((squad) => squad.squadName)) : 'Nobody yet'}
                  label={SUMMARY_TILE_LABELS[tile.tile]}
                  value={tile.count}
                />
              </div>
            ))}
          </MetricGrid>

          {recordBook}

          {years.length ? (
            <div className="space-y-5" data-testid="all-years-list">
              {years.map((year) => (
                <SectionCard
                  footer={{ label: 'Championship', testId: `all-years-year-link-${year.year}`, to: buildLeagueChampionshipsPath(leagueCode, year.year) }}
                  key={year.year}
                  testId={`all-years-year-${year.year}`}
                  title={historyYearTitle(year)}
                  trailing={describeHistoryChampions(year)}
                >
                  {year.cups.length ? (
                    <SectionRows>
                      {year.cups.map((cup) => (
                        <SectionRow
                          facts={describeHistoryCup(cup)}
                          key={cup.cupId}
                          name={cup.name}
                          testId={`all-years-cup-${cup.cupId}`}
                          to={buildLeaguePointsRacePath(leagueCode, year.year, cup.sportLeagueId)}
                        />
                      ))}
                    </SectionRows>
                  ) : (
                    <SectionEmpty>No cups this year.</SectionEmpty>
                  )}
                </SectionCard>
              ))}
            </div>
          ) : (
            <SectionCard help="Each year's champions show here once contests go final." title="Every year">
              <SectionEmpty testId="all-years-empty">Nothing has counted yet.</SectionEmpty>
            </SectionCard>
          )}
        </>
      )}
    </section>
  );
}
