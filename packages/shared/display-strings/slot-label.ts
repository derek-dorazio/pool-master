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
