import { displayString } from '../../display-strings/display-strings';
import { SportLeagueNoun, type Sport } from '../enums';
import type { SportNoun } from './sport-definition';
import { sportNoun } from './sport-vocabulary';

/**
 * What screens call one sport league: its own noun where it has one (#834: the NCAA's tennis
 * championships are leagues), else what its sport calls a sport league (the ATP is a tour). A
 * league's own noun reads the generic `word.sportLeague`, the one noun `SportLeagueNoun` has.
 */
export function sportLeagueNounOf(sport: Sport, leagueNoun: SportLeagueNoun | null, locale?: string | null): SportNoun {
  switch (leagueNoun) {
    case null:
      return sportNoun(sport, 'sportLeague', locale);
    case SportLeagueNoun.LEAGUE:
      return { one: displayLeague(1, locale), many: displayLeague(2, locale) };
  }
}

function displayLeague(count: number, locale: string | null | undefined): string {
  return displayString('word.sportLeague', { count }, locale);
}
