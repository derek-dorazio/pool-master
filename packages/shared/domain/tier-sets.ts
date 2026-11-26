import { SeasonSlotStatus, SportEventStatus } from './enums';
import type { SportEventTierSlot } from './sport-catalog-types';

/**
 * Whether a slot's set may still change (#431, #2044): the event's first slot only while the event
 * is a draft, since it is released with it; a later slot until that slot starts. The one lock rule.
 */
export function isTierSetEditable(event: { status: SportEventStatus }, slot: Pick<SportEventTierSlot, 'isFirstSlot' | 'seasonSlotStatus'>): boolean {
  return slot.isFirstSlot ? event.status === SportEventStatus.DRAFT : slot.seasonSlotStatus === SeasonSlotStatus.SCHEDULED;
}

/** An event's first slot among its slots as `SportEventTierSlot` reads them (#2044); undefined for an event covering none. */
export function firstTierSlotOf<Slot extends Pick<SportEventTierSlot, 'isFirstSlot'>>(slots: readonly Slot[]): Slot | undefined {
  return slots.find((slot) => slot.isFirstSlot);
}
