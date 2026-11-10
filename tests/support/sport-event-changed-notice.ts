import { BackgroundJobType, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { SportEventChangedNotice } from '../../packages/core-api/src/modules/notifications';
import { mockFn } from './mock-fn';

/** The job the recording notice below answers for one event change: recognisable, not real. */
export function eventChangedJob(sportEventId: string, kind: string): BackgroundJobRequest {
  return {
    type: BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS,
    payload: { sportEventId, kind },
    dedupeKey: `CONTEST_EVENT_CHANGED_EMAILS:${sportEventId}:${kind}`,
  };
}

/**
 * An event-changed notice that answers one `eventChangedJob` per change it is asked about, and
 * records each change it is told of in `order` as `told <kind>`.
 */
export function recordingSportEventChangedNotice(order: string[] = []) {
  return {
    sportEventChangedJobs: mockFn<SportEventChangedNotice['sportEventChangedJobs']>(async (sportEvent, change) => {
      order.push(`told ${change.kind}`);
      return [eventChangedJob(sportEvent.id, change.kind)];
    }),
    sportEventChanged: mockFn<SportEventChangedNotice['sportEventChanged']>(async (_sportEvent, change) => {
      order.push(`told ${change.kind}`);
    }),
  };
}
