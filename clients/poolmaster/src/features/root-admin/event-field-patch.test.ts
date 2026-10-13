import { describe, expect, it } from 'vitest';
import {
  buildEventFieldPatch,
  buildEventFieldPatches,
  eventFieldCellInvalid,
  eventFieldCellValue,
  eventFieldInvalidCount,
  type EventFieldEntry,
} from './event-field-patch';
import { fieldEntryFixture, valuationFixture } from './sport-test-fixtures';

// plans/124 §6.3 — pure patch/validation logic for the Field editor.

// #236: a field row is the shared SportEventParticipant; its price is on the valuation.
function entry(overrides: Partial<EventFieldEntry> = {}): EventFieldEntry {
  return fieldEntryFixture({
    id: 'sep-1',
    participantId: 'p-1',
    ranking: 2,
    oddsToWin: 8.5,
    seedNumber: 2,
    valuation: valuationFixture({ price: 9500 }),
    ...overrides,
  });
}

describe('pool-master-za4 event-field-patch: eventFieldCellValue', () => {
  it('pool-master-za4 shows the draft edit when present, else the server value', () => {
    expect(eventFieldCellValue(entry(), { ranking: '5' }, 'ranking')).toBe('5');
    expect(eventFieldCellValue(entry(), undefined, 'ranking')).toBe('2');
  });

  it('pool-master-za4 coalesces a null/undefined server value to an empty string (not "null")', () => {
    expect(
      eventFieldCellValue(
        entry({ valuation: null }),
        undefined,
        'price',
      ),
    ).toBe('');
    expect(
      eventFieldCellValue(
        entry({ seedNumber: null }),
        undefined,
        'seedNumber',
      ),
    ).toBe('');
  });
});

describe('pool-master-za4 event-field-patch: validators', () => {
  it('pool-master-za4 treats an empty string as valid (not edited)', () => {
    expect(eventFieldCellInvalid('', 'ranking')).toBe(false);
  });
  it('pool-master-za4 rejects non-positive / non-integer rank and seed', () => {
    expect(eventFieldCellInvalid('0', 'ranking')).toBe(true);
    expect(eventFieldCellInvalid('3.5', 'seedNumber')).toBe(true);
    expect(eventFieldCellInvalid('abc', 'oddsToWin')).toBe(true);
  });
  it('flags a rank or seed above the largest 32-bit integer, which the server refuses, and accepts the largest one', () => {
    expect(eventFieldCellInvalid('2147483648', 'ranking')).toBe(true);
    expect(eventFieldCellInvalid('2147483648', 'seedNumber')).toBe(true);
    expect(eventFieldCellInvalid('2147483647', 'ranking')).toBe(false);
  });
  it('pool-master-za4 allows a zero price but not a negative one', () => {
    expect(eventFieldCellInvalid('0', 'price')).toBe(false);
    expect(eventFieldCellInvalid('-1', 'price')).toBe(true);
  });
  it('pool-master-za4 allows a decimal odds value', () => {
    expect(eventFieldCellInvalid('12.5', 'oddsToWin')).toBe(false);
  });
  it('pool-master-za4 counts invalid cells across the whole draft', () => {
    expect(
      eventFieldInvalidCount({
        'sep-1': { ranking: '0', price: '10' },
        'sep-2': { oddsToWin: 'x' },
      }),
    ).toBe(2);
  });
});

describe('pool-master-za4 event-field-patch: buildEventFieldPatch', () => {
  it('pool-master-za4 returns null when nothing changed', () => {
    expect(buildEventFieldPatch(entry(), {})).toBeNull();
    expect(buildEventFieldPatch(entry(), { ranking: '2' })).toBeNull();
  });

  it('pool-master-za4 emits only the changed numeric fields', () => {
    expect(buildEventFieldPatch(entry(), { ranking: '1', price: '9500' })).toEqual({
      sportEventParticipantId: 'sep-1',
      ranking: 1,
    });
  });

  it('pool-master-za4 ignores an invalid numeric draft value', () => {
    expect(buildEventFieldPatch(entry(), { seedNumber: 'oops' })).toBeNull();
  });

  it('pool-master-za4 emits isActive:false + a default WITHDRAWN reason when toggled out without picking a reason', () => {
    expect(buildEventFieldPatch(entry(), { isActive: false })).toEqual({
      sportEventParticipantId: 'sep-1',
      isActive: false,
      inactiveReason: 'WITHDRAWN',
    });
  });

  it('pool-master-za4 treats a reason change on an already-inactive golfer as a change (isActive untouched)', () => {
    const inactive = entry({ isActive: false, inactiveReason: 'WITHDRAWN' });
    expect(buildEventFieldPatch(inactive, { inactiveReason: 'ELIMINATED' })).toEqual({
      sportEventParticipantId: 'sep-1',
      isActive: false,
      inactiveReason: 'ELIMINATED',
    });
  });

  it('pool-master-za4 emits no reason when re-activating a golfer', () => {
    const inactive = entry({ isActive: false, inactiveReason: 'ELIMINATED' });
    expect(buildEventFieldPatch(inactive, { isActive: true })).toEqual({
      sportEventParticipantId: 'sep-1',
      isActive: true,
    });
  });

  it('pool-master-za4 buildEventFieldPatches only includes rows that actually changed', () => {
    const entries = [entry(), entry({ id: 'sep-2', participantId: 'p-2' })];
    const patches = buildEventFieldPatches(entries, {
      'sep-2': { oddsToWin: '10' },
      'sep-1': { ranking: '2' },
    });
    expect(patches).toEqual([{ sportEventParticipantId: 'sep-2', oddsToWin: 10 }]);
  });
});
