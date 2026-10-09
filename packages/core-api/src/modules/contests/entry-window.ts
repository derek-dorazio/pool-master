/**
 * When a contest's entries can change: the one rule behind entering, renaming, leaving and
 * picking (ContestService and SelectionService both ask it).
 *
 * Entries change only while the contest is OPEN (#117), and only until its event's scheduled
 * start time, the same cutoff opening a contest uses. The contest moves on from OPEN when the
 * event is marked In Progress, but that update can be late, and a lineup must not change after
 * tee-off while it is.
 */
import type { Contest, SportEventStatus } from '@poolmaster/shared/domain';
import { ContestStatus } from '@poolmaster/shared/domain';
import { hasSportEventStarted } from '../events/operational-timing';

export function areContestEntriesOpen(
  contest: Pick<Contest, 'status'>,
  sportEvent: { status: SportEventStatus; startDate: Date } | null,
  now: Date,
): boolean {
  if (contest.status !== ContestStatus.OPEN) {
    return false;
  }
  return !sportEvent || !hasSportEventStarted(sportEvent, now);
}
