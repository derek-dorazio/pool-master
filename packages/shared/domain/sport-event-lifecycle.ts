import { SportEventStatus } from './enums';

/**
 * Declared SportEvent lifecycle transitions, keyed by current status. Enforced
 * strictly for admin-driven transitions (`422 SPORT_EVENT_INVALID_TRANSITION`
 * on an undeclared jump); provider-driven ingestion stays permissive and
 * applies an undeclared jump anyway, only logging it — see plans/124 §3.3.
 *
 * `as const satisfies Record<SportEventStatus, ...>` gives compile-time
 * exhaustiveness: adding a new SportEventStatus value without adding its row
 * here is a type error, not a silent gap.
 */
export const SPORT_EVENT_STATUS_TRANSITIONS = {
  [SportEventStatus.SCHEDULED]: [
    SportEventStatus.IN_PROGRESS,
    SportEventStatus.POSTPONED,
    SportEventStatus.CANCELLED,
  ],
  [SportEventStatus.IN_PROGRESS]: [
    SportEventStatus.COMPLETED,
    SportEventStatus.POSTPONED,
    SportEventStatus.CANCELLED,
  ],
  [SportEventStatus.POSTPONED]: [
    SportEventStatus.SCHEDULED,
    SportEventStatus.IN_PROGRESS,
    SportEventStatus.CANCELLED,
  ],
  // Terminal — nothing transitions out of COMPLETED or CANCELLED.
  [SportEventStatus.COMPLETED]: [],
  [SportEventStatus.CANCELLED]: [],
} as const satisfies Record<SportEventStatus, readonly SportEventStatus[]>;

/** Whether `toStatus` is a declared transition out of `fromStatus`. A status "transitioning" to itself is always allowed — see isSameStatusTransition. */
export function isDeclaredSportEventTransition(
  fromStatus: SportEventStatus,
  toStatus: SportEventStatus,
): boolean {
  return (SPORT_EVENT_STATUS_TRANSITIONS[fromStatus] as readonly SportEventStatus[]).includes(toStatus);
}
