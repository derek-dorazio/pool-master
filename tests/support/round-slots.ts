/**
 * A round's slot as the round and match reads give it (#2006), for tests that build rounds and
 * games by hand. Each kind (and week) is its own Season slot, so rounds of different kinds read
 * as played in different slots. Test code only.
 */
import { SlotKind, SlotPairing, type SportEventRoundSlot } from '@poolmaster/shared/domain';

export function roundSlot(slotKind: SlotKind, overrides: Partial<SportEventRoundSlot> = {}): SportEventRoundSlot {
  return {
    seasonSlotId: `season-slot-${slotKind}-${String(overrides.weekNumber ?? 0)}`,
    name: null,
    slotKind,
    weekNumber: null,
    seriesGames: 1,
    pairing: SlotPairing.FIXED,
    ...overrides,
  };
}

/** A week of games' slot. */
export function weekRoundSlot(weekNumber = 1): SportEventRoundSlot {
  return roundSlot(SlotKind.WEEK, { weekNumber });
}

/**
 * The slots of a bracket of `rounds` rounds, first to final: the last is the FINAL, the one before
 * it the SEMIFINAL, the earlier ones kinds of their own, as a league's postseason definitions are.
 */
export function bracketRoundSlots(rounds: number, overrides: Partial<SportEventRoundSlot> = {}): SportEventRoundSlot[] {
  const kinds = [SlotKind.PLAY_IN, SlotKind.ROUND_OF_64, SlotKind.ROUND_OF_32, SlotKind.ROUND_OF_16, SlotKind.QUARTERFINAL, SlotKind.SEMIFINAL, SlotKind.FINAL];
  if (rounds > kinds.length) throw new Error(`A test bracket has at most ${String(kinds.length)} rounds, not ${String(rounds)}.`);
  return kinds.slice(kinds.length - rounds).map((slotKind) => roundSlot(slotKind, overrides));
}
