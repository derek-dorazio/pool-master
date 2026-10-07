import {
  SportEventStatus,
  type SportEventReadinessReason,
  type SportEventReadinessStatus,
} from '@poolmaster/shared/domain';

export interface EventOperationalState {
  readinessStatus: SportEventReadinessStatus;
  readinessReasons: SportEventReadinessReason[];
  contestEligible: boolean;
}

/** Statuses an event reaches only once it has started (or been called off). */
const STARTED_STATUSES: readonly SportEventStatus[] = [
  SportEventStatus.IN_PROGRESS,
  SportEventStatus.COMPLETED,
  SportEventStatus.CANCELLED,
];

/**
 * Whether the event is past its contest cutoff: its start time has passed, or its status
 * says it has started or been called off. A contest can't be created or opened on it (#117,
 * #431).
 */
export function hasSportEventStarted(event: { status: SportEventStatus; startDate: Date }, now: Date): boolean {
  return event.startDate <= now || STARTED_STATUSES.includes(event.status);
}

/**
 * Whether a contest can be built on the event right now (#431): an admin has released it
 * (it is no longer `DRAFT`), its field is loaded, and it hasn't started.
 */
export function evaluateEventOperationalState(input: {
  status: SportEventStatus;
  startDate: Date;
  participantCount?: number | null;
  now?: Date;
}): EventOperationalState {
  const now = input.now ?? new Date();
  const readinessReasons: SportEventReadinessReason[] = [];

  if (input.status === SportEventStatus.DRAFT) {
    readinessReasons.push('EVENT_NOT_RELEASED');
  }

  if ((input.participantCount ?? 0) <= 0) {
    readinessReasons.push('FIELD_NOT_LOADED');
  }

  if (hasSportEventStarted(input, now)) {
    readinessReasons.push('EVENT_STARTED');
  }

  let readinessStatus: SportEventReadinessStatus = 'CONTEST_ELIGIBLE';
  if (readinessReasons.includes('EVENT_STARTED')) {
    readinessStatus = 'EVENT_STARTED';
  } else if (readinessReasons.includes('EVENT_NOT_RELEASED')) {
    readinessStatus = 'NOT_RELEASED';
  } else if (readinessReasons.includes('FIELD_NOT_LOADED')) {
    readinessStatus = 'PENDING_FIELD';
  }

  return {
    readinessStatus,
    readinessReasons,
    contestEligible: readinessReasons.length === 0,
  };
}
