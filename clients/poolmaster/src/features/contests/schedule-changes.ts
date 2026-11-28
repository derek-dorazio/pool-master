import { SportEventStatus } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';

/** What the schedule-change line reads of a contest's events. */
type ScheduledEvent = Pick<ContestDto['sportEvents'][number], 'name' | 'status'>;

/** How many schedule changes the line names before it counts the rest. */
const MAX_SCHEDULE_CHANGES = 3;

/**
 * The one line under a contest's header when any of its events is cancelled (#1768): "Week 13
 * cancelled: no points." Null when none is. A postponement is a Game's (#2013), shown on the game.
 * Past three changes it names the latest three and counts the rest ("Plus 2 more earlier.").
 */
export function describeScheduleChanges(sportEvents: readonly ScheduledEvent[]): string | null {
  const lines = sportEvents
    .filter((sportEvent) => sportEvent.status === SportEventStatus.CANCELLED)
    .map((sportEvent) => `${sportEvent.name} cancelled: no points.`);
  if (lines.length <= MAX_SCHEDULE_CHANGES) {
    return lines.length ? lines.join(' ') : null;
  }
  // A long season keeps one short line: its latest changes, and how many earlier ones there were.
  return `${lines.slice(-MAX_SCHEDULE_CHANGES).join(' ')} Plus ${String(lines.length - MAX_SCHEDULE_CHANGES)} more earlier.`;
}

/**
 * Which schedule chip a contest's one-line status (League Home's rows, #1768) carries: Cancelled
 * once every one of its events is cancelled, otherwise none. A season with one cancelled week goes
 * on, so that week shows only on the contest's own pages.
 */
export function contestScheduleChipStatus(
  sportEvents: readonly Pick<ScheduledEvent, 'status'>[],
): typeof SportEventStatus.CANCELLED | null {
  if (sportEvents.length > 0 && sportEvents.every((sportEvent) => sportEvent.status === SportEventStatus.CANCELLED)) {
    return SportEventStatus.CANCELLED;
  }
  return null;
}
