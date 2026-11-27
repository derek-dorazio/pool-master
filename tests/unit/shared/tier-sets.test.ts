import { expect } from '@jest/globals';
import { chooseTierSetSlot, chooseTierSetSlots, contestTierSetSlot, isTierSetEditable, SeasonSlotStatus, SelectionType, SportEventStatus, TIER_SET_SELECTION_TYPES, tierSetSlotOf } from '@poolmaster/shared/domain';

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

describe('chooseTierSetSlots', () => {
  it('gives a set to every slot a tiered or budget template lists, in play order, and none to a play-in no such template covers', () => {
    const playIn = { key: 'PLAY_IN', listedByTierSetTemplate: false };
    const roundOf64 = { key: 'ROUND_OF_64', listedByTierSetTemplate: true };
    const roundOf32 = { key: 'ROUND_OF_32', listedByTierSetTemplate: false };
    const sweet16 = { key: 'SWEET_16', listedByTierSetTemplate: true };

    expect(chooseTierSetSlots([playIn, roundOf64, roundOf32, sweet16])).toEqual([roundOf64, sweet16]);
  });

  it('gives a set to the first slot alone when no tiered or budget template lists any, and to none for an event covering no slot', () => {
    const semifinal = { key: 'SEMIFINAL', listedByTierSetTemplate: false };
    const final = { key: 'FINAL', listedByTierSetTemplate: false };

    expect([chooseTierSetSlots([semifinal, final]), chooseTierSetSlots<typeof final>([])]).toEqual([[semifinal], []]);
  });
});

describe('TIER_SET_SELECTION_TYPES', () => {
  it('names the tiered roster and the budget pick as the only selection types that pick from a tier set', () => {
    expect([...TIER_SET_SELECTION_TYPES].sort()).toEqual([SelectionType.BUDGET_PICK, SelectionType.TIERED].sort());
  });
});

describe('isTierSetEditable', () => {
  it('lets the tier-set slot\'s set change while its event is a draft, and locks it once the event is released, whatever its slot\'s status', () => {
    const slot = { isTierSetSlot: true, seasonSlotStatus: SeasonSlotStatus.SCHEDULED };

    expect([isTierSetEditable({ status: SportEventStatus.DRAFT }, slot), isTierSetEditable({ status: SportEventStatus.SCHEDULED }, slot)]).toEqual([true, false]);
  });

  it('lets another slot\'s set change until that slot starts, whatever its event\'s status', () => {
    const released = { status: SportEventStatus.SCHEDULED };

    expect([
      isTierSetEditable(released, { isTierSetSlot: false, seasonSlotStatus: SeasonSlotStatus.SCHEDULED }),
      isTierSetEditable(released, { isTierSetSlot: false, seasonSlotStatus: SeasonSlotStatus.IN_PROGRESS }),
    ]).toEqual([true, false]);
  });
});

describe('tierSetSlotOf', () => {
  it('finds the slot marked as its event\'s tier-set slot, and none for an event covering no slot', () => {
    const playIn = { id: 'play-in', isTierSetSlot: false };
    const roundOf64 = { id: 'round-of-64', isTierSetSlot: true };

    expect([tierSetSlotOf([playIn, roundOf64]), tierSetSlotOf<typeof playIn>([])]).toEqual([roundOf64, undefined]);
  });
});

describe('contestTierSetSlot', () => {
  const roundOf64 = { id: 'round-of-64', slotDefinitionId: 'def-r64', holdsTierSet: true, isTierSetSlot: true };
  const roundOf32 = { id: 'round-of-32', slotDefinitionId: 'def-r32', holdsTierSet: false, isTierSetSlot: false };
  const sweet16 = { id: 'sweet-16', slotDefinitionId: 'def-s16', holdsTierSet: true, isTierSetSlot: false };
  const slots = [roundOf64, roundOf32, sweet16];

  it('picks the first slot a contest covers that holds a set, so a Sweet 16 contest reads the Sweet 16 set, not the event\'s first', () => {
    expect([contestTierSetSlot(slots, ['def-r32', 'def-s16']), contestTierSetSlot(slots, ['def-r64', 'def-s16'])]).toEqual([sweet16, roundOf64]);
  });

  it('falls back to the event\'s tier-set slot for a contest whose coverage is unknown or covers no slot holding a set, and to none for an event with no slot', () => {
    expect([contestTierSetSlot(slots, null), contestTierSetSlot(slots, ['def-r32']), contestTierSetSlot<typeof sweet16>([], ['def-s16'])]).toEqual([roundOf64, roundOf64, undefined]);
  });
});
