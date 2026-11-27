import { hasSportEventStarted, type SportEventStatus } from './enums';

/** What the current-slot rule reads of a covered slot: its own start, when its games are placed, and its event. */
export type CoveredSlotTiming = {
  readonly startsAt: Date | string | null;
  readonly sportEventId: string | null;
};

/** What it reads of the event that plays a slot. */
export type CoveredSlotEventTiming = {
  readonly status: SportEventStatus;
  readonly startDate: Date | string;
};

/**
 * Whether a covered slot has started (#2014): its event has started and, when its own games give
 * it a start, that start has passed too. So a bracket's later round has not started while its
 * first is played, and a slot with no event yet has not started.
 */
function hasCoveredSlotStarted(
  slot: CoveredSlotTiming,
  eventsById: ReadonlyMap<string, CoveredSlotEventTiming>,
  now: Date,
): boolean {
  const event = slot.sportEventId === null ? undefined : eventsById.get(slot.sportEventId);
  if (event === undefined || !hasSportEventStarted(event, now)) return false;
  if (slot.startsAt === null) return true;
  const startsAt = typeof slot.startsAt === 'string' ? Date.parse(slot.startsAt) : slot.startsAt.getTime();
  return startsAt <= now.getTime();
}

/**
 * The slot a contest's pages open on when none is named (#2014), the one place it is worked out:
 * its first covered slot that has not started (the one being picked), else its last (the latest
 * played). `slots` are in play order; undefined only for a contest that covers none.
 */
export function currentCoveredSlot<Slot extends CoveredSlotTiming>(
  slots: readonly Slot[],
  eventsById: ReadonlyMap<string, CoveredSlotEventTiming>,
  now: Date,
): Slot | undefined {
  // poolmaster-allow-position: play order, so the last covered slot is the latest played
  return slots.find((slot) => !hasCoveredSlotStarted(slot, eventsById, now)) ?? slots.at(-1);
}
