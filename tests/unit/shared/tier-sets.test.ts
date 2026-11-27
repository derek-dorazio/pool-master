import { expect } from '@jest/globals';
import { chooseTierSetSlot, SelectionType, TIER_SET_SELECTION_TYPES } from '@poolmaster/shared/domain';

describe('chooseTierSetSlot', () => {
  it('picks the first slot in play order that a tiered or budget template lists, past a play-in no such template covers', () => {
    const playIn = { key: 'PLAY_IN', listedByTierSetTemplate: false };
    const roundOf64 = { key: 'ROUND_OF_64', listedByTierSetTemplate: true };
    const roundOf32 = { key: 'ROUND_OF_32', listedByTierSetTemplate: true };

    expect(chooseTierSetSlot([playIn, roundOf64, roundOf32])).toBe(roundOf64);
  });

  it('picks the first slot in play order when no tiered or budget template lists any of them', () => {
    const semifinal = { key: 'SEMIFINAL', listedByTierSetTemplate: false };
    const final = { key: 'FINAL', listedByTierSetTemplate: false };

    expect(chooseTierSetSlot([semifinal, final])).toBe(semifinal);
  });

  it('picks no slot for an event covering none', () => {
    expect(chooseTierSetSlot<{ listedByTierSetTemplate: boolean }>([])).toBeUndefined();
  });
});

describe('TIER_SET_SELECTION_TYPES', () => {
  it('names the tiered roster and the budget pick as the only selection types that pick from a tier set', () => {
    expect([...TIER_SET_SELECTION_TYPES].sort()).toEqual([SelectionType.BUDGET_PICK, SelectionType.TIERED].sort());
  });
});
