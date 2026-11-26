/**
 * What every screen calls a slot (#2002, plan §1): its proper name, else the word for its kind.
 */
import { expect } from '@jest/globals';
import { roundLabels, slotLabel } from '@poolmaster/shared/display-strings';
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

describe('roundLabels', () => {
  const slot = (seasonSlotId: string, slotKind: SlotKind, name: string | null = null, weekNumber: number | null = null) => ({ seasonSlotId, slotKind, name, weekNumber });

  it('names each round of an event played a round per slot by its slot: a play-in and a bracket read their own slots, not a count back from the final', () => {
    const label = roundLabels([
      { roundNumber: 1, slot: slot('s1', SlotKind.PLAY_IN, 'First Four') },
      { roundNumber: 2, slot: slot('s2', SlotKind.ROUND_OF_64) },
      { roundNumber: 3, slot: slot('s3', SlotKind.FINAL, 'National Championship') },
    ]);

    expect([1, 2, 3].map(label)).toEqual(['First Four', 'Round of 64', 'National Championship']);
  });

  it('numbers the rounds of an event that plays several in one slot (a golf tournament\'s four, a Slam\'s seven), and a round it does not hold', () => {
    const masters = slot('s-masters', SlotKind.TOURNAMENT, 'The Masters');
    const label = roundLabels([1, 2, 3, 4].map((roundNumber) => ({ roundNumber, slot: masters })));

    expect([1, 4].map(label)).toEqual(['Round 1', 'Round 4']);
    expect(roundLabels([])(2)).toBe('Round 2');
  });

  it('names a week\'s one round by its week', () => {
    expect(roundLabels([{ roundNumber: 1, slot: slot('w14', SlotKind.WEEK, null, 14) }])(1)).toBe('Week 14');
  });
});
