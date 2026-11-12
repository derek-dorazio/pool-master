import { useSearchParams } from 'react-router';
import type { Sport } from '@poolmaster/shared/domain';

/** A sport as the filter offers it: its name and the sport leagues under it. */
export interface FilterableSport {
  sport: Sport;
  name: string;
  leagues: readonly { slug: string; name: string }[];
}

/** A sport as a page's link names it: `?sport=horse-racing`. */
export function sportSlug(sport: Sport) {
  return sport.toLowerCase().replaceAll('_', '-');
}

/**
 * The sport and sport league a page's link names (`?sport=golf&league=pga-tour`), among the ones
 * it offers, and how to choose another, kept in the link. A link naming a sport or league the page
 * does not offer shows every sport. How to Play and Contest types both read the choice this way.
 */
export function useSportLeagueChoice<S extends FilterableSport>(sports: readonly S[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const sport = sports.find((candidate) => sportSlug(candidate.sport) === searchParams.get('sport')) ?? null;
  const leagueSlug = sport?.leagues.find((league) => league.slug === searchParams.get('league'))?.slug ?? null;
  const choose = (chosen: Sport | null, league?: string) => {
    setSearchParams(chosen ? { sport: sportSlug(chosen), ...(league ? { league } : {}) } : {}, { replace: true });
  };
  return { choose, leagueSlug, sport };
}
