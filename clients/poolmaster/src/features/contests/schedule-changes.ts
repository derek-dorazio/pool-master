import { SportEventStatus } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';

/** What the schedule-change line reads of a contest's events. */
type ScheduledEvent = Pick<ContestDto['sportEvents'][number], 'name' | 'startDate' | 'status'>;

/**
 * The one line under a contest's header when any of its events is not going ahead as scheduled
 * (#1768): "Week 12 postponed to Mon, Nov 24, 8:15 PM. Week 13 cancelled: no points." Null when
 * every event is on schedule. `formatStart` words a start time as the viewer reads it.
 */
export function describeScheduleChanges(
  sportEvents: readonly ScheduledEvent[],
  formatStart: (startDate: string) => string,
): string | null {
  const lines = sportEvents.flatMap((sportEvent) => {
    if (sportEvent.status === SportEventStatus.POSTPONED) {
      return [`${sportEvent.name} postponed to ${formatStart(sportEvent.startDate)}.`];
    }
    if (sportEvent.status === SportEventStatus.CANCELLED) {
      return [`${sportEvent.name} cancelled: no points.`];
    }
    return [];
  });
  return lines.length ? lines.join(' ') : null;
}

/**
 * Which schedule chip a contest's one-line status (League Home's rows, #1768) carries: Postponed
 * while any of its events is postponed, Cancelled once every one is cancelled, otherwise none. A
 * season with one cancelled week goes on, so that week shows only on the contest's own pages.
 */
export function contestScheduleChipStatus(
  sportEvents: readonly Pick<ScheduledEvent, 'status'>[],
): typeof SportEventStatus.POSTPONED | typeof SportEventStatus.CANCELLED | null {
  if (sportEvents.some((sportEvent) => sportEvent.status === SportEventStatus.POSTPONED)) {
    return SportEventStatus.POSTPONED;
  }
  if (sportEvents.length > 0 && sportEvents.every((sportEvent) => sportEvent.status === SportEventStatus.CANCELLED)) {
    return SportEventStatus.CANCELLED;
  }
  return null;
}
