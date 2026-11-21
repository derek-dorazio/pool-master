import { BackgroundJobType, JobTrigger, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { SportEventChangedNotice } from '../../packages/core-api/src/modules/notifications';
import { mockFn } from './mock-fn';

/** The job the recording notice below answers for one event change: recognisable, not real. */
export function eventChangedJob(sportEventId: string, kind: string): BackgroundJobRequest {
  return {
    type: BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS,
    payload: { sportEventId, kind },
    dedupeKey: `CONTEST_EVENT_CHANGED_EMAILS:${sportEventId}:${kind}`,
    start: { trigger: JobTrigger.SYSTEM },
  };
}

/** An event-changed notice that answers one `eventChangedJob` per change it is asked about. */
export function recordingSportEventChangedNotice() {
  return {
    sportEventChangedJobs: mockFn<SportEventChangedNotice['sportEventChangedJobs']>(async (sportEvent, change) => [eventChangedJob(sportEvent.id, change.kind)]),
  };
}
