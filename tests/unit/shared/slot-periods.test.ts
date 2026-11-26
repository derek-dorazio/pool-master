import { PeriodUnit, periodNoun, slotPeriodsOf } from '@poolmaster/shared/domain';

describe('a slot\'s periods (#2047): its definition\'s unit and count, with their words from the display strings', () => {
  it('reads the unit and count together, and none for a slot that keeps no score by period', () => {
    expect(slotPeriodsOf({ periodUnit: PeriodUnit.HALF, periodCount: 2 })).toEqual({ unit: PeriodUnit.HALF, count: 2 });
    expect(slotPeriodsOf({ periodUnit: null, periodCount: null })).toBeNull();
  });

  it.each([
    [PeriodUnit.QUARTER, 'quarter', 'quarters'],
    [PeriodUnit.HALF, 'half', 'halves'],
    [PeriodUnit.PERIOD, 'period', 'periods'],
    [PeriodUnit.INNING, 'inning', 'innings'],
    [PeriodUnit.HOLE, 'hole', 'holes'],
  ])('calls one %s period a "%s" and several "%s"', (unit, one, many) => {
    expect(periodNoun(unit)).toEqual({ one, many });
  });
});
