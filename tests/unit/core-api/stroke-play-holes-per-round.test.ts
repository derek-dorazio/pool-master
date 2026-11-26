import { MatchFormat, PeriodUnit, SlotKind } from '@poolmaster/shared/domain';
import { holesPerRound } from '../../../packages/core-api/src/modules/scoring-families/stroke-play/unplayed-rounds';

// A stroke-play round's holes are the period count of the slot its rounds are played in (#2047).
function slot(id: string, count: number | null) {
  return { id, slotKind: SlotKind.TOURNAMENT, canEndTied: false, periods: count === null ? null : { unit: PeriodUnit.HOLE, count }, matchFormat: MatchFormat.FIELD };
}

describe('holesPerRound', () => {
  it('is the hole count of the slot the event\'s rounds are played in', () => {
    expect(holesPerRound({ slotDefinitions: [slot('open', 18)] })).toBe(18);
    expect(holesPerRound({ slotDefinitions: [slot('par-3', 9)] })).toBe(9);
  });

  it('is unknown for an event that covers no slot, a slot with no hole count, or slots that disagree', () => {
    expect(holesPerRound({ slotDefinitions: [] })).toBeNull();
    expect(holesPerRound({ slotDefinitions: [slot('open', null)] })).toBeNull();
    expect(holesPerRound({ slotDefinitions: [slot('open', 18), slot('par-3', 9)] })).toBeNull();
  });
});
