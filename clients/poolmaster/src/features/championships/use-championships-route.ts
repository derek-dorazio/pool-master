import { useParams } from 'react-router-dom';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { parseChampionshipYearParam } from './championship-year';

/**
 * What every Championships page reads from its route: the league, the viewer and the year.
 * `ChampionshipsLayout` has already loaded the league and checked the year before a page renders.
 */
export function useChampionshipsRoute() {
  const { leagueCode = '', year: yearParam } = useParams<{ leagueCode: string; year: string }>();
  const { league, viewer } = useLeagueContext(leagueCode);
  return {
    league,
    leagueCode,
    leagueId: league?.id ?? '',
    viewer,
    year: parseChampionshipYearParam(yearParam) ?? 0,
  };
}
