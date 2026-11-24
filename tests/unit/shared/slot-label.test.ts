/**
 * What every screen calls a slot (#2002, plan §1): its proper name, else the word for its kind.
 */
import { expect } from '@jest/globals';
import { slotLabel } from '@poolmaster/shared/display-strings';
import { SlotKind } from '@poolmaster/shared/domain';

describe('slotLabel', () => {
  it('names a slot by its proper name, a nameless week by its number, and any other nameless slot by the word for its kind', () => {
    expect(slotLabel({ name: 'Super Bowl', slotKind: SlotKind.FINAL, weekNumber: null })).toBe('Super Bowl');
    expect(slotLabel({ name: null, slotKind: SlotKind.WEEK, weekNumber: 14 })).toBe('Week 14');
    expect(slotLabel({ name: null, slotKind: SlotKind.QUARTERFINAL, weekNumber: null })).toBe('Quarterfinal');
  });

  it('falls back to the word for a week when a week has no number', () => {
    expect(slotLabel({ name: null, slotKind: SlotKind.WEEK, weekNumber: null })).toBe('Week');
  });
});
