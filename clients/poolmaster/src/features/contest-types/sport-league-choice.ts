import { useSearchParams } from 'react-router';
import type { Sport } from '@poolmaster/shared/domain';

/** A sport league as the switch offers it: its name, and its URL segment, its name in the page's link. */
export interface FilterableLeague {
  urlSegment: string;
  name: string;
}

/**
 * A sport as the switch offers it: its name, its leagues, and the number beside it, which is how many contest types the page lists with the sport chosen (#1716):
 * How to Play's ways to play, Contest types' tiles under all its leagues.
 */
export interface FilterableSport {
  sport: Sport;
  /** Its URL segment, as the API gives it: its name in the page's link, `?sport=horse-racing`. */
  urlSegment: string;
  name: string;
  leagues: readonly FilterableLeague[];
  count: number;
}

/** What a page's link has chosen: a whole sport, or one of its leagues. */
export interface SportLeagueChoice<S extends FilterableSport> {
  sport: S | null;
  league: S['leagues'][number] | null;
  choose: (sportUrlSegment: string | null, leagueUrlSegment?: string) => void;
}

/** A choice as a page's link spells it, by URL segments: `?sport=hockey&league=nhl`. */
export function sportLeagueChoiceSearch(sportUrlSegment: string | null, leagueUrlSegment?: string) {
  if (!sportUrlSegment) {
    return '';
  }
  const params = new URLSearchParams({ sport: sportUrlSegment });
  if (leagueUrlSegment) {
    params.set('league', leagueUrlSegment);
  }
  return `?${params.toString()}`;
}

/**
 * The sport and league a page's link names, among the ones it offers, and how to choose another,
 * kept in the link. A link naming a sport or league the page does not offer drops back to the
 * widest choice it does. How to Play and Contest types both read the choice this way.
 */
export function useSportLeagueChoice<S extends FilterableSport>(sports: readonly S[]): SportLeagueChoice<S> {
  const [searchParams, setSearchParams] = useSearchParams();
  const sport = sports.find((candidate) => candidate.urlSegment === searchParams.get('sport')) ?? null;
  const league = sport?.leagues.find((candidate) => candidate.urlSegment === searchParams.get('league')) ?? null;
  const choose = (chosen: string | null, chosenLeague?: string) => {
    setSearchParams(new URLSearchParams(sportLeagueChoiceSearch(chosen, chosenLeague)), { replace: true });
  };
  return { choose, league, sport };
}

/** A chosen league as one chip names it: "NHL". Null with no league chosen. */
export function sportLeagueChoiceLabel(choice: Pick<SportLeagueChoice<FilterableSport>, 'league'>) {
  return choice.league?.name ?? null;
}

/** What a heading plays: "hockey", "NHL". Null with every sport shown. */
export function sportLeagueChoiceObject(choice: Pick<SportLeagueChoice<FilterableSport>, 'sport' | 'league'>) {
  return choice.league?.name ?? choice.sport?.name.toLowerCase() ?? null;
}
