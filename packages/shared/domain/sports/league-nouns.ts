import { SportLeagueNoun, type Sport } from '../enums';
import { getSportDefinition } from './registry';
import type { SportNoun } from './sport-definition';

/** What each sport league noun reads as on screen. */
export const SPORT_LEAGUE_NOUNS: Readonly<Record<SportLeagueNoun, SportNoun>> = {
  [SportLeagueNoun.LEAGUE]: { one: 'league', many: 'leagues' },
};

/**
 * What screens call one sport league: its own noun where it has one (#834: the NCAA's tennis
 * championships are leagues), else what its sport calls a sport league (the ATP is a tour).
 */
export function sportLeagueNounOf(sport: Sport, leagueNoun: SportLeagueNoun | null): SportNoun {
  return leagueNoun === null ? getSportDefinition(sport).vocabulary.sportLeague : SPORT_LEAGUE_NOUNS[leagueNoun];
}
