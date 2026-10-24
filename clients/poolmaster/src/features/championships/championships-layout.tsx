import { PlanFeature, championshipYear } from '@poolmaster/shared/domain';
import { useEffect, useMemo } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import {
  buildLeagueChampionshipsPath,
  buildLeagueHistoryPath,
  buildLeagueTrophyCasePath,
} from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { PlanLockedNotice } from '@/features/plans/plan-locked-notice';
import { LinkButton, PageHeader, SegmentedControl, Select } from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { championshipsTitle, championshipYearsOffered, parseChampionshipYearParam } from './championship-year';
import { useChampionshipYearsQuery } from './use-championship-query';
import { useCupSeasonsQuery } from './use-cups-query';
import { YearReviewBanner } from './year-review-banner';

type ChampionshipsTab = 'championship' | 'trophies' | 'race';

/** Championships with no year opens the current one. */
export function ChampionshipsRedirect() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  return <Navigate replace to={buildLeagueChampionshipsPath(leagueCode, championshipYear(new Date()))} />;
}

/**
 * Championships (#841, #863): one header for the year and a segmented sub-menu between its pages
 * (rules/ux-rules.md §12 rule 9). Championship, where every year lands, is the league championship
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

  const tabPaths = (forYear: number): Record<ChampionshipsTab, string> => ({
    championship: buildLeagueChampionshipsPath(leagueCode, forYear),
    trophies: buildLeagueTrophyCasePath(leagueCode, forYear),
    race: `${buildLeagueChampionshipsPath(leagueCode, forYear)}/race`,
  });
  const paths = tabPaths(year);
  const tab: ChampionshipsTab = pathname.startsWith(paths.race)
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
      <PageHeader
        actions={(
          <>
            <Select
              aria-label="Year"
              className="w-auto"
              data-testid="championships-year"
              onChange={(event) => navigate(tabPaths(Number(event.target.value))[tab])}
              value={year}
            >
              {years.map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
            <SegmentedControl
              aria-label="Championship views"
              onChange={(next) => navigate(paths[next as ChampionshipsTab])}
              options={[
                { label: 'Championship', testId: 'championships-tab-championship', value: 'championship' },
                { label: 'Trophy case', testId: 'championships-tab-trophies', value: 'trophies' },
                { label: 'Points race', testId: 'championships-tab-race', value: 'race' },
              ]}
              value={tab}
            />
            <LinkButton data-testid="championships-all-years" size="sm" to={buildLeagueHistoryPath(leagueCode)} variant="secondary">
              All years
            </LinkButton>
          </>
        )}
        title={championshipsTitle(year, new Date())}
      />
      {league ? <YearReviewBanner isCommissioner={viewer.isCommissioner} league={league} /> : null}
      {isPastYearLocked
        ? <PlanLockedNotice feature={PlanFeature.PAST_YEARS} isCommissioner={viewer.isCommissioner} leagueCode={leagueCode} />
        : <Outlet />}
    </section>
  );
}
