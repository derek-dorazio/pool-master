/**
 * A contest covers Season slots (#2014), in play order, each played by one of its events: a golf
 * contest's one tournament, an NFL pick'em's weeks, a bracket's rounds of one tournament. These
 * read a contest's slots, their events and an entry's per-event status as the API gives them.
 */
import { ContestEntryStatus, hasSportEventStarted } from '@poolmaster/shared/domain';
import type { ContestDto, ContestEntryDto } from '@/lib/api';

export type ContestEvent = ContestDto['sportEvents'][number];

/** Whether an event has started: its start time has passed, or its status says it is under way or over. */
export function hasContestEventStarted(
  sportEvent: Pick<ContestEvent, 'status' | 'startDate'>,
  now: Date = new Date(),
): boolean {
  return hasSportEventStarted(sportEvent, now);
}

export type ContestCoveredSlot = ContestDto['coveredSlots'][number];

type CoverageOf = Pick<ContestDto, 'sportEvents' | 'coveredSlots'>;

/** The contest's event that plays `slot`, or null for no slot or a slot no event plays yet. */
export function eventOfSlot(contest: Pick<ContestDto, 'sportEvents'>, slot: ContestCoveredSlot | null | undefined): ContestEvent | null {
  if (!slot?.sportEventId) return null;
  return contest.sportEvents.find((sportEvent) => sportEvent.sportEventId === slot.sportEventId) ?? null;
}

/** The event of the contest's first covered slot: its start is when the contest stops taking new entries. */
export function eventOfFirstSlot(contest: CoverageOf): ContestEvent | null {
  return eventOfSlot(contest, contest.coveredSlots.at(0));
}

/** The event of the contest's last covered slot: the contest settles when it does. */
export function eventOfLastSlot(contest: CoverageOf): ContestEvent | null {
  return eventOfSlot(contest, contest.coveredSlots.at(-1));
}

/** The covered slot the contest's pages open on when none is named, as the API decides it (`currentSlotId`). */
function currentSlot(contest: Pick<ContestDto, 'coveredSlots' | 'currentSlotId'>): ContestCoveredSlot | null {
  return contest.coveredSlots.find((slot) => slot.seasonSlotId === contest.currentSlotId) ?? null;
}

/** The event of that slot: the one a contest's pages open on when none is named. */
export function eventOfCurrentSlot(contest: CoverageOf & Pick<ContestDto, 'currentSlotId'>): ContestEvent | null {
  return eventOfSlot(contest, currentSlot(contest));
}

/** An entry's status for one event: not submitted until that event's picks are. */
export function entryEventStatus(
  entry: Pick<ContestEntryDto, 'events'>,
  sportEventId: string | null | undefined,
): ContestEntryStatus {
  return entry.events.find((event) => event.sportEventId === sportEventId)?.status ?? ContestEntryStatus.DRAFT;
}

