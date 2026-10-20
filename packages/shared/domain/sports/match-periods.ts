import { MatchPeriodLayout, type Sport } from '../enums';
import { getSportDefinition } from './registry';
import type { SportMatchPeriods } from './sport-definition';

/** What each period layout is: how many periods a game has, overtime aside, and what one is called. */
export const MATCH_PERIOD_LAYOUTS: Readonly<Record<MatchPeriodLayout, SportMatchPeriods>> = {
  [MatchPeriodLayout.QUARTERS]: { count: 4, label: { one: 'quarter', many: 'quarters' } },
  [MatchPeriodLayout.HALVES]: { count: 2, label: { one: 'half', many: 'halves' } },
};

/**
 * The periods a game of the sport league is played in: the league's own layout, else its sport's
 * (#786). Undefined for a sport whose games keep no score by period.
 */
export function matchPeriodsOf(sport: Sport, leagueLayout: MatchPeriodLayout | null): SportMatchPeriods | undefined {
  const layout = matchPeriodLayoutOf(sport, leagueLayout);
  return layout === undefined ? undefined : MATCH_PERIOD_LAYOUTS[layout];
}

/** The layout `matchPeriodsOf` reads: the sport league's own, else its sport's; undefined for a sport without periods. */
export function matchPeriodLayoutOf(sport: Sport, leagueLayout: MatchPeriodLayout | null): MatchPeriodLayout | undefined {
  const layout = getSportDefinition(sport).matchPeriodLayout;
  return layout === undefined ? undefined : leagueLayout ?? layout;
}
