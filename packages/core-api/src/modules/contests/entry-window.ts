/**
 * When a contest's entries and picks can change, and when its picks are revealed: the rules
 * behind entering, renaming, leaving, picking and submitting (ContestService and SelectionService
 * both ask them).
 *
 * A contest covers one or more events (#713), and each event is its own small workflow: its picks
 * open while the contest takes them and close at that event's scheduled start. The event moves on
 * when it is marked In Progress, but that update can be late, and a lineup must not change after
 * tee-off while it is.
 *
 * Joining, leaving and renaming are the contest's: only while it is OPEN (#117) and before its
 * first event starts, so nobody joins a contest already being played (design Q5.6).
 *
 * A random draw closes entries early (#601): once it has dealt, nobody may enter, leave or
 * change an entry, or the deal would no longer be the one every entry was given.
 */
import type { Contest, SportEventStatus } from '@poolmaster/shared/domain';
import { ContestStatus } from '@poolmaster/shared/domain';
import { hasSportEventStarted } from '../events/operational-timing';

type EventTiming = { status: SportEventStatus; startDate: Date };

/** Contest statuses whose events take picks: OPEN, and ACTIVE while a later event is still to start. */
const PICKING_STATUSES: readonly ContestStatus[] = [ContestStatus.OPEN, ContestStatus.ACTIVE];

/** Whether entries can be created, renamed or left: the contest is OPEN, undrawn, and none of its events has started. */
export function areContestEntriesOpen(
  contest: Pick<Contest, 'status' | 'drawnAt'>,
  sportEvents: readonly EventTiming[],
  now: Date,
): boolean {
  if (contest.status !== ContestStatus.OPEN || contest.drawnAt !== undefined) {
    return false;
  }
  return !sportEvents.some((sportEvent) => hasSportEventStarted(sportEvent, now));
}

/** Whether one event's picks can change, and its lineup be submitted: the contest takes picks, is undrawn, and the event has not started. */
export function areEventPicksOpen(
  contest: Pick<Contest, 'status' | 'drawnAt'>,
  sportEvent: EventTiming,
  now: Date,
): boolean {
  if (!PICKING_STATUSES.includes(contest.status) || contest.drawnAt !== undefined) {
    return false;
  }
  return !hasSportEventStarted(sportEvent, now);
}

/**
 * Whether one event's picks are visible to everyone in the league, not only their owners.
 *
 * pool-master-dxd.13: picks are hidden from non-owners while the contest takes entries (DRAFT or
 * OPEN). Once it is live, each event's picks are revealed when that event starts (#713), so week
 * 7's picks stay hidden while week 6 is played. A random draw is public from the moment it is
 * dealt (#601): nobody chose those picks, so there is nothing to hide.
 */
export function areEventPicksRevealed(
  contest: Pick<Contest, 'status' | 'drawnAt'>,
  sportEvent: EventTiming,
  now: Date,
): boolean {
  if (contest.drawnAt !== undefined) {
    return true;
  }
  if (contest.status === ContestStatus.DRAFT || contest.status === ContestStatus.OPEN) {
    return false;
  }
  return contest.status === ContestStatus.COMPLETED || hasSportEventStarted(sportEvent, now);
}

/**
 * The event a contest's pages open on when none is named: its next event that has not started
 * (the one being picked), else its last (the latest played). `sportEvents` is in sequence order.
 */
export function currentContestEvent<Event extends EventTiming>(sportEvents: readonly Event[], now: Date): Event | undefined {
  return sportEvents.find((sportEvent) => !hasSportEventStarted(sportEvent, now)) ?? sportEvents.at(-1);
}
