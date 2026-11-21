/**
 * Domain events (#1946): a typed record of one change to a model entity, named in the past tense
 * and carrying ids and the from/to values. A write that sets off work beyond itself describes its
 * change as one of these, and the one handler map (`DOMAIN_EVENT_HANDLERS`) decides what follows
 * it (`rules/architecture-rules.md` §4 *Follow-up work is a domain event handler*).
 *
 * A type names a model entity and its change, never a sport or league. A member's fields are
 * additive only: a new optional field, never a renamed or removed one, so the shape can be
 * published unchanged if the delivery ever moves out of process.
 */

import type { SportEvent, SportEventStatus } from '@poolmaster/shared/domain';

export const DomainEventType = {
  /** A sport event's status moved (`EventLifecycleService.applySportEventStatusTransition`). */
  SPORT_EVENT_STATUS_CHANGED: 'SPORT_EVENT_STATUS_CHANGED',
  /** A sport event's start moved, by an admin's edit that tells its leagues; each handler decides which statuses it acts on. */
  SPORT_EVENT_RESCHEDULED: 'SPORT_EVENT_RESCHEDULED',
} as const;
export type DomainEventType = (typeof DomainEventType)[keyof typeof DomainEventType];

export interface SportEventStatusChanged {
  type: typeof DomainEventType.SPORT_EVENT_STATUS_CHANGED;
  /** The event as it stood before the change, so no handler reads it again. */
  sportEvent: Pick<SportEvent, 'id' | 'startDate' | 'eventSeriesId' | 'eventYear'>;
  from: SportEventStatus;
  to: SportEventStatus;
  /** When the event's contests settle if `to` finishes it: its end, or the moment it was cancelled. */
  settleAt: Date;
  /**
   * The live contests the change takes back to OPEN (#1792). Their reopen's own email tells their
   * members, so the event changed email leaves them out (#1910).
   */
  reopeningContestIds: ReadonlySet<string>;
}

export interface SportEventRescheduled {
  type: typeof DomainEventType.SPORT_EVENT_RESCHEDULED;
  /** The event with its new start. */
  sportEvent: Pick<SportEvent, 'id' | 'startDate' | 'status'>;
  previousStart: Date;
  /** The live contests the new start reopens, told by their reopen's email instead (#1910). */
  reopeningContestIds: ReadonlySet<string>;
}

/** Every domain event: one member per entity change, discriminated by `type`. */
export type DomainEvent = SportEventStatusChanged | SportEventRescheduled;

/** The member of `DomainEvent` whose type is `T`. */
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;
