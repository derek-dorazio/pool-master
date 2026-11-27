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
 * Which of an event's slots, in play order, hold a tier set (#2044): every slot a contest of an
 * active tiered or budget template of its league may start at, as that template's coverage allows
 * (`STARTS_AT_EACH_LISTED_SLOT_BY_COVERAGE`): each listed slot for a template covering one slot or
 * a slot onwards, the first of the event's listed slots for a template covering them all. The
 * first slot alone when no such template lists any; none for an event covering no slot. The one
 * rule for which slots hold a set.
 */
export function chooseTierSetSlots<Slot extends { tierSetTemplates: readonly TierSetTemplateListing[] }>(slotsInPlayOrder: readonly Slot[]): Slot[] {
  const firstListing = new Map<string, Slot>();
  for (const slot of slotsInPlayOrder) {
    for (const template of slot.tierSetTemplates) {
      if (!firstListing.has(template.templateId)) firstListing.set(template.templateId, slot);
    }
  }
  const starting = slotsInPlayOrder.filter((slot) => slot.tierSetTemplates.some((template) =>
    STARTS_AT_EACH_LISTED_SLOT_BY_COVERAGE[template.coverageMode] || firstListing.get(template.templateId) === slot));
  return starting.length > 0 ? starting : slotsInPlayOrder.slice(0, 1);
}

/**
 * Which of an event's slots holds its tier set, the one released with the event (#2044): the first
 * of those holding a set (`chooseTierSetSlots`), so a league's play-in, which no tiered or budget
 * template covers, is passed over; undefined for an event covering no slot.
 */
export function chooseTierSetSlot<Slot extends { tierSetTemplates: readonly TierSetTemplateListing[] }>(slotsInPlayOrder: readonly Slot[]): Slot | undefined {
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
