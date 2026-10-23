import { championshipYear } from '@poolmaster/shared/domain';
import { useEffect, useMemo } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import {
  buildLeagueChampionshipsPath,
  buildLeagueTrophyCasePath,
} from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { PageHeader, SegmentedControl } from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { championshipsTitle, parseChampionshipYearParam } from './championship-year';

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
 * standings, race chart and contests.
 */
export function ChampionshipsLayout() {
  const { leagueCode = '', year: yearParam } = useParams<{ leagueCode: string; year: string }>();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const logger = useMemo(() => getLogger().child({ feature: 'championships-layout' }), []);
  const { query: leagueQuery } = useLeagueContext(leagueCode);
  const year = parseChampionshipYearParam(yearParam);

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

  const yearPath = buildLeagueChampionshipsPath(leagueCode, year);
  const paths: Record<ChampionshipsTab, string> = {
    championship: yearPath,
    trophies: buildLeagueTrophyCasePath(leagueCode, year),
    race: `${yearPath}/race`,
  };
  const tab: ChampionshipsTab = pathname.startsWith(paths.race)
    ? 'race'
    : pathname.startsWith(paths.trophies) ? 'trophies' : 'championship';

  return (
    <section className="space-y-6" data-testid="championships-page">
      <PageHeader
        actions={(
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
        )}
        title={championshipsTitle(year, new Date())}
      />
      <Outlet />
    </section>
  );
}
