/**
 * A contest covers one or more sport events (#713), in order: a golf contest has one, an NFL
 * pick'em has a week per event. These read a contest's events and an entry's per-event status
 * the way the server's contest rules do.
 */
import { ContestEntryStatus, SelectionType, SportEventStatus } from '@poolmaster/shared/domain';
import type { ContestDto, ContestEntryDto } from '@/lib/api';

export type ContestSportEvent = ContestDto['sportEvents'][number];

const STARTED_STATUSES: readonly SportEventStatus[] = [
  SportEventStatus.IN_PROGRESS,
  SportEventStatus.COMPLETED,
  SportEventStatus.CANCELLED,
];

/** Whether an event has started: its start time has passed, or its status says it is under way or over. */
export function hasContestEventStarted(
  sportEvent: Pick<ContestSportEvent, 'status' | 'startDate'>,
  now: Date = new Date(),
): boolean {
  return Date.parse(sportEvent.startDate) <= now.getTime() || STARTED_STATUSES.includes(sportEvent.status);
}

/**
 * Whether a contest of this selection type covers exactly one event, so its events never change:
 * a random draw deals one event's field, and a bracket (#721) is one knockout picked to its final.
 */
export function coversOneEvent(selectionType: SelectionType): boolean {
  return selectionType === SelectionType.RANDOM_DRAW || selectionType === SelectionType.BRACKET;
}

/** The contest's first event: its start is when the contest stops taking new entries. */
export function firstContestEvent(contest: Pick<ContestDto, 'sportEvents'>): ContestSportEvent | null {
  return contest.sportEvents.at(0) ?? null;
}

/** The contest's last event: the contest settles when it does. */
export function lastContestEvent(contest: Pick<ContestDto, 'sportEvents'>): ContestSportEvent | null {
  return contest.sportEvents.at(-1) ?? null;
}

/**
 * The event a contest's pages open on: its next event that has not started (the one being
 * picked), else its last (the latest played). The server picks the same one when none is named.
 */
export function currentContestEvent(
  contest: Pick<ContestDto, 'sportEvents'>,
  now: Date = new Date(),
): ContestSportEvent | null {
  return contest.sportEvents.find((sportEvent) => !hasContestEventStarted(sportEvent, now)) ?? lastContestEvent(contest);
}

/** An entry's status for one event: not submitted until that event's picks are. */
export function entryEventStatus(
  entry: Pick<ContestEntryDto, 'events'>,
  sportEventId: string | null | undefined,
): ContestEntryStatus {
  return entry.events.find((event) => event.sportEventId === sportEventId)?.status ?? ContestEntryStatus.DRAFT;
}

