/**
 * Multi-event contests (#713): the rules for reading a contest's events and an entry's status in
 * each, pure so the server and the web read them one way.
 */
import { ContestEntryStatus } from './enums';
import type { ContestEntry } from './types';

/** The entry's status for one event of its contest; a DRAFT when the entry has no row for it. */
export function contestEntryEventStatus(
  entry: Pick<ContestEntry, 'events'>,
  sportEventId: string,
): ContestEntryStatus {
  return entry.events.find((event) => event.sportEventId === sportEventId)?.status ?? ContestEntryStatus.DRAFT;
}

/** Whether the entry has submitted at least one event: what makes it count as an entry (#481). */
export function hasSubmittedAnyEvent(entry: Pick<ContestEntry, 'events'>): boolean {
  return entry.events.some((event) => event.status === ContestEntryStatus.SUBMITTED);
}
