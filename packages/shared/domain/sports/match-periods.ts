import { displayString } from '../../display-strings/display-strings';
import { MatchPeriodLayout, type Sport } from '../enums';
import { getSportDefinition } from './registry';
import type { SportMatchPeriods } from './sport-definition';

/** What each period layout is: how many periods a game has, overtime aside, and the key of its noun. */
export const MATCH_PERIOD_LAYOUTS: Readonly<Record<MatchPeriodLayout, { readonly count: number; readonly noun: 'word.quarter' | 'word.half' | 'word.period' }>> = {
  [MatchPeriodLayout.QUARTERS]: { count: 4, noun: 'word.quarter' },
  [MatchPeriodLayout.HALVES]: { count: 2, noun: 'word.half' },
  [MatchPeriodLayout.THREE_PERIODS]: { count: 3, noun: 'word.period' },
};

/**
 * The periods a game of the sport league is played in: the league's own layout, else its sport's
 * (#786), with what one is called in the reader's language. Undefined for a sport whose games
 * keep no score by period.
 */
export function matchPeriodsOf(sport: Sport, leagueLayout: MatchPeriodLayout | null, locale?: string | null): SportMatchPeriods | undefined {
  const layout = matchPeriodLayoutOf(sport, leagueLayout);
  if (layout === undefined) return undefined;
  const { count, noun } = MATCH_PERIOD_LAYOUTS[layout];
  return { count, label: { one: displayString(noun, { count: 1 }, locale), many: displayString(noun, { count: 2 }, locale) } };
}

/** The layout `matchPeriodsOf` reads: the sport league's own, else its sport's; undefined for a sport without periods. */
export function matchPeriodLayoutOf(sport: Sport, leagueLayout: MatchPeriodLayout | null): MatchPeriodLayout | undefined {
  const layout = getSportDefinition(sport).matchPeriodLayout;
  return layout === undefined ? undefined : leagueLayout ?? layout;
}
