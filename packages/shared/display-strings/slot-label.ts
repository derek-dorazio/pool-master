import { SlotKind } from '../domain/enums';
import { displayString, enumLabel } from './display-strings';

/** The three facts a slot's on-screen name is read from. */
export type SlotLabelSource = {
  readonly name: string | null;
  readonly slotKind: SlotKind;
  readonly weekNumber: number | null;
};

/**
 * What a slot is called on every screen that shows one (#2002, plan §1): its proper name, else the
 * word for its kind ("Week 14", "Semifinal"). The one copy of the rule, so no screen words a slot
 * its own way.
 */
export function slotLabel(slot: SlotLabelSource): string {
  if (slot.name !== null) return slot.name;
  return slot.slotKind === SlotKind.WEEK && slot.weekNumber !== null
    ? displayString('word.weekNumber', { n: slot.weekNumber })
    : enumLabel('SlotKind', slot.slotKind);
}

/**
 * What each of an event's rounds is called (#2006), read from any of its rounds or games: the
 * label of the slot it is played in, where it is the slot's only round. Rounds that share a slot
 * (a golf tournament's four) and a round number none of them carries read "Round N".
 */
export function roundLabels(
  rounds: ReadonlyArray<{ readonly roundNumber: number; readonly slot: SlotLabelSource & { readonly seasonSlotId: string } }>,
): (roundNumber: number) => string {
  const slotOf = new Map(rounds.map((round) => [round.roundNumber, round.slot]));
  const roundsPerSlot = new Map<string, number>();
  for (const slot of slotOf.values()) roundsPerSlot.set(slot.seasonSlotId, (roundsPerSlot.get(slot.seasonSlotId) ?? 0) + 1);
  return (roundNumber) => {
    const slot = slotOf.get(roundNumber);
    return slot === undefined || (roundsPerSlot.get(slot.seasonSlotId) ?? 0) > 1
      ? displayString('word.roundNumber', { n: roundNumber })
      : slotLabel(slot);
  };
}
