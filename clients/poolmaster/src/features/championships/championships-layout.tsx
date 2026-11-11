import { PlanFeature, championshipYear } from '@poolmaster/shared/domain';
import { useEffect, useMemo } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import { buildLeagueChampionshipsPath } from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { PlanLockedNotice } from '@/features/plans/plan-locked-notice';
import { getLogger } from '@/lib/logger';
import { ChampionshipsHeader } from './championships-header';
import {
  type ChampionshipsYearTab,
  championshipsTitle,
  championshipsYearTabPaths,
  championshipYearsOffered,
  parseChampionshipYearParam,
} from './championship-year';
import { useChampionshipYearsQuery } from './use-championship-query';
import { useCupSeasonsQuery } from './use-cups-query';
import { YearReviewBanner } from './year-review-banner';

/** Championships with no year opens the current one. */
export function ChampionshipsRedirect() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  return <Navigate replace to={buildLeagueChampionshipsPath(leagueCode, championshipYear(new Date()))} />;
}

/**
 * Championships (#841, #863, #1543): the shared Championships header over the year's pages.
 * Championship, where every year lands, is the league championship
 * across every sport; Trophy case has a card per sports league cup; Points race is one cup's
 * standings, race chart and contests. The year picker (#837) changes every tab to another year
 * the league has a championship or a cup in; the year is in the path, so a year can be shared.
 * Without PAST_YEARS on the league's plan it offers only the current year, and an earlier year
 * opened from a link shows the locked note in place of its page (#948).
 */
export function ChampionshipsLayout() {
  const { leagueCode = '', year: yearParam } = useParams<{ leagueCode: string; year: string }>();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const logger = useMemo(() => getLogger().child({ feature: 'championships-layout' }), []);
  const { league, query: leagueQuery, viewer } = useLeagueContext(leagueCode);
  const year = parseChampionshipYearParam(yearParam);
  const currentYear = championshipYear(new Date());
  const hasPastYears = hasPlanFeature(league, PlanFeature.PAST_YEARS);
  // The year lists name earlier years, so they are asked for only on a plan that shows them.
  const championshipYearsQuery = useChampionshipYearsQuery(
    hasPastYears && hasPlanFeature(league, PlanFeature.CHAMPIONSHIP) ? league?.id ?? '' : '',
  );
  const cupSeasonsQuery = useCupSeasonsQuery(hasPastYears && hasPlanFeature(league, PlanFeature.CUP_STANDINGS) ? league?.id ?? '' : '');

  useEffect(() => {
    if (leagueQuery.isError) {
      logger.warn(
        { action: 'championships.league.failed', data: { leagueCode }, err: leagueQuery.error },
        'Championships failed to load league context',
      );
    }
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const leagueContext = useLeagueContextGuard(leagueQuery, { loadingBody: 'Loading championships...' });
  if (year === null) {
    return <Navigate replace to={buildLeagueChampionshipsPath(leagueCode)} />;
  }
  if (leagueContext.state === 'blocked') {
    return leagueContext.element;
  }

  const paths = championshipsYearTabPaths(leagueCode, year);
  const tab: ChampionshipsYearTab = pathname.startsWith(paths.race)
    ? 'race'
    : pathname.startsWith(paths.trophies) ? 'trophies' : 'championship';
  // A year being read is offered even before its lists load, or when a link names a year with nothing in it.
  const years = championshipYearsOffered(
    [year, ...(championshipYearsQuery.data ?? []).map((row) => row.year)],
    cupSeasonsQuery.data ?? [],
    currentYear,
  );
  const isPastYearLocked = year < currentYear && !hasPastYears;

  return (
    <section className="space-y-6" data-testid="championships-page">
      <ChampionshipsHeader
        leagueCode={leagueCode}
        season={{
          onChange: (nextYear) => void navigate(championshipsYearTabPaths(leagueCode, nextYear)[tab]),
          years,
        }}
        tab={tab}
        title={championshipsTitle(year, new Date())}
        year={year}
      />
      {league ? <YearReviewBanner isCommissioner={viewer.isCommissioner} league={league} /> : null}
      {isPastYearLocked
        ? <PlanLockedNotice feature={PlanFeature.PAST_YEARS} isCommissioner={viewer.isCommissioner} leagueCode={leagueCode} />
        : <Outlet />}
    </section>
  );
}
