import { SeasonSlotStatus, SelectionType, SportEventStatus } from './enums';
import type { SportEventTierSlot } from './sport-catalog-types';

/**
 * Whether a contest of each selection type picks from its event's tier set (#2044): a tiered roster
 * by tier, a budget pick by price. The other types read no tiers or prices.
 */
const READS_TIER_SET_BY_SELECTION_TYPE = {
  [SelectionType.TIERED]: true,
  [SelectionType.BUDGET_PICK]: true,
  [SelectionType.RANDOM_DRAW]: false,
  [SelectionType.PICK_EM]: false,
  [SelectionType.BRACKET]: false,
  [SelectionType.SURVIVOR]: false,
  [SelectionType.SQUARES]: false,
} as const satisfies Readonly<Record<SelectionType, boolean>>;

/** The selection types whose contests pick from a tier set, from `READS_TIER_SET_BY_SELECTION_TYPE`. */
export const TIER_SET_SELECTION_TYPES: readonly SelectionType[] = Object.values(SelectionType)
  .filter((selectionType) => READS_TIER_SET_BY_SELECTION_TYPE[selectionType]);

/**
 * Which of an event's slots, in play order, holds the tier set its tiered and budget contests read
 * (#2044): the first one a tiered or budget template of its league lists, since a template starts
 * at its first listed slot (a league's play-in comes first but no such template covers it); the
 * first slot when no such template lists any; undefined for an event covering no slot. The one rule.
 */
export function chooseTierSetSlot<Slot extends { listedByTierSetTemplate: boolean }>(slotsInPlayOrder: readonly Slot[]): Slot | undefined {
  return slotsInPlayOrder.find((slot) => slot.listedByTierSetTemplate) ?? slotsInPlayOrder.at(0);
}

/**
 * Whether a slot's set may still change (#431, #2044): the event's tier-set slot only while the
 * event is a draft, since it is released with it; another slot until that slot starts. The one lock rule.
 */
export function isTierSetEditable(event: { status: SportEventStatus }, slot: Pick<SportEventTierSlot, 'isTierSetSlot' | 'seasonSlotStatus'>): boolean {
  return slot.isTierSetSlot ? event.status === SportEventStatus.DRAFT : slot.seasonSlotStatus === SeasonSlotStatus.SCHEDULED;
}

/** An event's tier-set slot among its slots as `SportEventTierSlot` reads them (#2044); undefined for an event covering none. */
export function tierSetSlotOf<Slot extends Pick<SportEventTierSlot, 'isTierSetSlot'>>(slots: readonly Slot[]): Slot | undefined {
  return slots.find((slot) => slot.isTierSetSlot);
}
