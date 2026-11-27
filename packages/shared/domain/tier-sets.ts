import { SeasonSlotStatus, SelectionType, SportEventStatus, TemplateCoverageMode } from './enums';
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
 * Whether a contest of a template with each coverage may start at any slot the template lists
 * (#2044): ONE_SLOT covers the one slot the commissioner picks, FROM_SLOT a starting slot the
 * commissioner picks and every later one; ALL_LISTED covers every listed slot of one event at
 * once, so it starts only at the first of them.
 */
const STARTS_AT_EACH_LISTED_SLOT_BY_COVERAGE = {
  [TemplateCoverageMode.ONE_SLOT]: true,
  [TemplateCoverageMode.ALL_LISTED]: false,
  [TemplateCoverageMode.FROM_SLOT]: true,
} as const satisfies Readonly<Record<TemplateCoverageMode, boolean>>;

/** An active tiered or budget template that lists a slot (`TIER_SET_SELECTION_TYPES`), as the tier-set rule reads it. */
export interface TierSetTemplateListing {
  templateId: string;
  coverageMode: TemplateCoverageMode;
}

/**
 * A slot as the tier-set rule reads it: the active tiered or budget templates that list it, and
 * whether a set was built for it, its tiers or prices made from a profile (#2226).
 */
export interface TierSetSlotChoice {
  tierSetTemplates: readonly TierSetTemplateListing[];
  storesSet: boolean;
}

/**
 * Which slots, in play order, active templates give a tier set (#2044): every slot a contest of an
 * active tiered or budget template of its league may start at, as that template's coverage allows
 * (`STARTS_AT_EACH_LISTED_SLOT_BY_COVERAGE`): each listed slot for a template covering one slot or
 * a slot onwards, the first of the event's listed slots for a template covering them all. Empty
 * when no such template lists any.
 */
function listedTierSetSlots<Slot extends TierSetSlotChoice>(slotsInPlayOrder: readonly Slot[]): Slot[] {
  const firstListing = new Map<string, Slot>();
  for (const slot of slotsInPlayOrder) {
    for (const template of slot.tierSetTemplates) {
      if (!firstListing.has(template.templateId)) firstListing.set(template.templateId, slot);
    }
  }
  return slotsInPlayOrder.filter((slot) => slot.tierSetTemplates.some((template) =>
    STARTS_AT_EACH_LISTED_SLOT_BY_COVERAGE[template.coverageMode] || firstListing.get(template.templateId) === slot));
}

/**
 * The event's tier-set slot, and whether it is a kept one (#2226). The templates choose the first
 * slot they give a set (`listedTierSetSlots`), or the first slot when they list none. A slot
 * whose set was built while a template chose it, and that no template lists now, is kept instead
 * while the chosen slot has no set of its own: an admin switching the template off, or taking the
 * slot off its list, leaves the event its tiers and prices.
 */
function tierSetChoice<Slot extends TierSetSlotChoice>(slotsInPlayOrder: readonly Slot[]): { slot: Slot | undefined; kept: boolean; listed: Slot[] } {
  const listed = listedTierSetSlots(slotsInPlayOrder);
  const chosen = listed.at(0) ?? slotsInPlayOrder.at(0);
  const kept = chosen?.storesSet === false ? slotsInPlayOrder.find((slot) => slot.storesSet && !listed.includes(slot)) : undefined;
  return kept === undefined ? { slot: chosen, kept: false, listed } : { slot: kept, kept: true, listed };
}

/**
 * Which of an event's slots, in play order, hold a tier set (#2044): the slots the templates give
 * one (`listedTierSetSlots`), or the first slot alone when they list none. When the event's
 * tier-set slot is a kept one (#2226), it holds the set and no slot before it does: an earlier
 * slot given one would be valued by the next sync and then taken for the tier-set slot, moving
 * the event's set, released or not (#431). Slots after it the templates list keep theirs. None
 * for an event covering no slot. The one rule for which slots hold a set.
 */
export function chooseTierSetSlots<Slot extends TierSetSlotChoice>(slotsInPlayOrder: readonly Slot[]): Slot[] {
  const { slot: tierSetSlot, kept, listed } = tierSetChoice(slotsInPlayOrder);
  if (tierSetSlot === undefined) return [];
  if (!kept) return listed.length > 0 ? listed : [tierSetSlot];
  const from = slotsInPlayOrder.indexOf(tierSetSlot);
  return slotsInPlayOrder.filter((slot, index) => slot === tierSetSlot || (index > from && listed.includes(slot)));
}

/**
 * Which of an event's slots holds its tier set, the one released with the event (#2044): the first
 * the templates give one, so a league's play-in, which no tiered or budget template covers, is
 * passed over; or a kept built slot no template lists now (`tierSetChoice`, #2226). Undefined for
 * an event covering no slot.
 */
export function chooseTierSetSlot<Slot extends TierSetSlotChoice>(slotsInPlayOrder: readonly Slot[]): Slot | undefined {
  return tierSetChoice(slotsInPlayOrder).slot;
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
