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
