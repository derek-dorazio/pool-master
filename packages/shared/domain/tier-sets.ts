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
 * Which of an event's slots, in play order, hold a tier set (#2044): every one a tiered or budget
 * template of its league lists, since such a template covers one slot the commissioner picks from
 * those it lists, so each is a possible starting point; the first slot alone when no such template
 * lists any; none for an event covering no slot. The one rule for which slots hold a set.
 */
export function chooseTierSetSlots<Slot extends { listedByTierSetTemplate: boolean }>(slotsInPlayOrder: readonly Slot[]): Slot[] {
  const listed = slotsInPlayOrder.filter((slot) => slot.listedByTierSetTemplate);
  return listed.length > 0 ? listed : slotsInPlayOrder.slice(0, 1);
}

/**
 * Which of an event's slots holds its tier set, the one released with the event (#2044): the first
 * of those holding a set (`chooseTierSetSlots`), so a league's play-in, which no tiered or budget
 * template covers, is passed over; undefined for an event covering no slot.
 */
export function chooseTierSetSlot<Slot extends { listedByTierSetTemplate: boolean }>(slotsInPlayOrder: readonly Slot[]): Slot | undefined {
  return chooseTierSetSlots(slotsInPlayOrder).at(0);
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

/**
 * The slot whose set a contest picks from (#2044): the first of its event's slots, in play order,
 * that holds a set and is one the contest covers (`coveredSlotDefinitionIds`, its slot definitions);
 * the event's tier-set slot for a contest whose coverage is not known (null) or that covers none
 * holding a set; undefined for an event covering no slot. The one rule every contest-side reader
 * goes through.
 */
export function contestTierSetSlot<Slot extends Pick<SportEventTierSlot, 'holdsTierSet' | 'isTierSetSlot' | 'slotDefinitionId'>>(
  slotsInPlayOrder: readonly Slot[],
  coveredSlotDefinitionIds: readonly string[] | null,
): Slot | undefined {
  const covered = coveredSlotDefinitionIds === null
    ? undefined
    : slotsInPlayOrder.find((slot) => slot.holdsTierSet && coveredSlotDefinitionIds.includes(slot.slotDefinitionId));
  return covered ?? tierSetSlotOf(slotsInPlayOrder);
}
