/**
 * What a game of a slot is played in (#2047): its slot definition's period unit and count,
 * overtime aside. A slot with no unit keeps no score by period (a race, a tennis match). Every
 * reader takes the periods from the game's slot, never from its sport or league.
 */
import { displayString } from '../display-strings/display-strings';
import { assertNever } from './assert-never';
import { PeriodUnit } from './enums';
import type { SportNoun } from './sports';

/** A slot's periods: four quarters, two halves, nine innings, eighteen holes. */
export interface SlotPeriods {
  unit: PeriodUnit;
  /** How many periods a game has, overtime aside; at least 1. */
  count: number;
}

/** A slot definition's two columns as one value: set together, or both null (a database check). */
export function slotPeriodsOf(definition: { periodUnit: PeriodUnit | null; periodCount: number | null }): SlotPeriods | null {
  return definition.periodUnit === null || definition.periodCount === null ? null : { unit: definition.periodUnit, count: definition.periodCount };
}

/** The display-string key of what one period of the unit is called ("quarter"). */
function periodNounKey(unit: PeriodUnit): 'word.quarter' | 'word.half' | 'word.period' | 'word.inning' | 'word.hole' {
  switch (unit) {
    case PeriodUnit.QUARTER:
      return 'word.quarter';
    case PeriodUnit.HALF:
      return 'word.half';
    case PeriodUnit.PERIOD:
      return 'word.period';
    case PeriodUnit.INNING:
      return 'word.inning';
    case PeriodUnit.HOLE:
      return 'word.hole';
    default:
      return assertNever(unit, 'period unit');
  }
}

/** What one period of the unit is called, in the reader's language: "quarter" / "quarters". */
export function periodNoun(unit: PeriodUnit, locale?: string | null): SportNoun {
  const noun = periodNounKey(unit);
  return { one: displayString(noun, { count: 1 }, locale), many: displayString(noun, { count: 2 }, locale) };
}
