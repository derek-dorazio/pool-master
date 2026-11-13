import { useSearchParams } from 'react-router';
import type { Sport } from '@poolmaster/shared/domain';

/** A sport league as the switch offers it: its name, and its name in the page's link. */
export interface FilterableRound {
  slug: string;
  name: string;
}

/**
 * A season league as the switch offers it, with the playoff rounds that belong to it (#1701: the
 * NHL with its Conference Finals and Stanley Cup Final). A league with no rounds is one line.
 */
export interface FilterableLeague extends FilterableRound {
  rounds: readonly FilterableRound[];
}

/**
 * A sport as the switch offers it: its name, its leagues, each with its rounds under it, and the
 * number beside it, which is how many contest types the page lists with the sport chosen (#1716):
 * How to Play's ways to play, Contest types' tiles under all its leagues.
 */
export interface FilterableSport {
  sport: Sport;
  name: string;
  leagues: readonly FilterableLeague[];
  count: number;
}

/** A sport as a page's link names it: `?sport=horse-racing`. */
export function sportSlug(sport: Sport) {
  return sport.toLowerCase().replaceAll('_', '-');
}

/**
 * Sport leagues, each playoff round under the season league its `parentId` names (#1701), in the
 * order given: a round follows its league, whatever the order put between them. A round whose
 * league is not among them stands as a league of its own.
 */
export function groupRounds<L extends { id: string; parentId: string | null }>(leagues: readonly L[]) {
  const ids = new Set(leagues.map((league) => league.id));
  const isRound = (league: L) => league.parentId !== null && league.parentId !== league.id && ids.has(league.parentId);
  return leagues
    .filter((league) => !isRound(league))
    .map((league) => ({ league, rounds: leagues.filter((round) => isRound(round) && round.parentId === league.id) }));
}

/** What a page's link has chosen: a whole sport, a season league with its rounds, or one part of it. */
export interface SportLeagueChoice<S extends FilterableSport> {
  sport: S | null;
  league: S['leagues'][number] | null;
  /**
   * One part of the chosen league: one of its rounds, or the league's own slug for its regular
   * season alone. Null with the whole league, or no league, chosen.
   */
  partSlug: string | null;
  /** The slugs of the sport leagues the choice holds, or null with a whole sport or every sport. */
  leagueSlugs: readonly string[] | null;
  choose: (sport: Sport | null, league?: string, part?: string) => void;
}

/** A choice as a page's link spells it: `?sport=hockey&league=nhl&part=stanley-cup-final`. */
export function sportLeagueChoiceSearch(sport: Sport | null, league?: string, part?: string) {
  if (!sport) {
    return '';
  }
  const params = new URLSearchParams({ sport: sportSlug(sport) });
  if (league) {
    params.set('league', league);
    if (part) {
      params.set('part', part);
    }
  }
  return `?${params.toString()}`;
}

/**
 * The sport, league and part a page's link names, among the ones it offers, and how to choose
 * another, kept in the link. A link naming a sport, league or part the page does not offer drops
 * back to the widest choice it does. How to Play and Contest types both read the choice this way.
 */
export function useSportLeagueChoice<S extends FilterableSport>(sports: readonly S[]): SportLeagueChoice<S> {
  const [searchParams, setSearchParams] = useSearchParams();
  const sport = sports.find((candidate) => sportSlug(candidate.sport) === searchParams.get('sport')) ?? null;
  const league = sport?.leagues.find((candidate) => candidate.slug === searchParams.get('league')) ?? null;
  const requestedPart = searchParams.get('part');
  const partSlug = league && (requestedPart === league.slug || league.rounds.some((round) => round.slug === requestedPart)) ? requestedPart : null;
  const leagueSlugs = partSlug ? [partSlug] : league ? [league.slug, ...league.rounds.map((round) => round.slug)] : null;
  const choose = (chosen: Sport | null, chosenLeague?: string, part?: string) => {
    setSearchParams(new URLSearchParams(sportLeagueChoiceSearch(chosen, chosenLeague, part)), { replace: true });
  };
  return { choose, league, leagueSlugs, partSlug, sport };
}

/** The chosen part's name: "Regular season", or the round's. Null with no part chosen. */
function partName({ league, partSlug }: Pick<SportLeagueChoice<FilterableSport>, 'league' | 'partSlug'>) {
  if (!league || !partSlug) {
    return null;
  }
  return partSlug === league.slug ? REGULAR_SEASON : league.rounds.find((round) => round.slug === partSlug)?.name ?? null;
}

/** A chosen league or part as one chip names it: "NHL", "NHL · Stanley Cup Final". Null with no league chosen. */
export function sportLeagueChoiceLabel(choice: Pick<SportLeagueChoice<FilterableSport>, 'league' | 'partSlug'>) {
  const part = partName(choice);
  return choice.league ? [choice.league.name, part].filter(Boolean).join(' · ') : null;
}

/**
 * What a heading plays: "hockey", "NHL", "the NHL regular season", "the Stanley Cup Final". Null
 * with every sport shown.
 */
export function sportLeagueChoiceObject(choice: Pick<SportLeagueChoice<FilterableSport>, 'sport' | 'league' | 'partSlug'>) {
  const { league, partSlug, sport } = choice;
  if (league && partSlug) {
    return partSlug === league.slug ? `the ${league.name} ${REGULAR_SEASON.toLowerCase()}` : `the ${partName(choice)}`;
  }
  return league?.name ?? sport?.name.toLowerCase() ?? null;
}

/** What the switch calls a season league's own events, beside its playoff rounds. */
export const REGULAR_SEASON = 'Regular season';
