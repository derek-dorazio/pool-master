import { describe, expect, it } from '@jest/globals';
import { MATCH_PERIOD_LAYOUTS, MatchPeriodLayout, Sport, matchPeriodLayoutOf, matchPeriodsOf } from '@poolmaster/shared/domain';

describe('matchPeriodsOf — the periods a sport league\'s games are played in (#786)', () => {
  it('plays a sport league with no layout of its own in its sport\'s quarters', () => {
    expect(matchPeriodsOf(Sport.BASKETBALL, null)).toEqual({ count: 4, label: { one: 'quarter', many: 'quarters' } });
    expect(matchPeriodsOf(Sport.AMERICAN_FOOTBALL, null)).toBe(MATCH_PERIOD_LAYOUTS[MatchPeriodLayout.QUARTERS]);
  });

  it('plays a sport league in its own layout when it has one: men\'s college basketball in two halves', () => {
    expect(matchPeriodsOf(Sport.BASKETBALL, MatchPeriodLayout.HALVES)).toEqual({ count: 2, label: { one: 'half', many: 'halves' } });
    expect(matchPeriodLayoutOf(Sport.BASKETBALL, MatchPeriodLayout.HALVES)).toBe(MatchPeriodLayout.HALVES);
  });

  it('gives no periods to a sport whose games keep no score by period, whatever its league says', () => {
    expect(matchPeriodsOf(Sport.GOLF, null)).toBeUndefined();
    expect(matchPeriodLayoutOf(Sport.HORSE_RACING, MatchPeriodLayout.HALVES)).toBeUndefined();
  });
});
