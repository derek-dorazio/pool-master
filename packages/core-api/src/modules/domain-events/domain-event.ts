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

import type { ContestEntryStatus, SportEvent, SportEventStatus } from '@poolmaster/shared/domain';

export const DomainEventType = {
  /** A sport event's status moved (`EventLifecycleService.applySportEventStatusTransition`). */
  SPORT_EVENT_STATUS_CHANGED: 'SPORT_EVENT_STATUS_CHANGED',
  /** A sport event's start moved, by an admin's edit that tells its leagues; each handler decides which statuses it acts on. */
  SPORT_EVENT_RESCHEDULED: 'SPORT_EVENT_RESCHEDULED',
  /**
   * What a sport event's boards are computed from changed: a score, a result, a standing, its
   * field, its games or its own details. Every results, field and bracket write of the event says so.
   */
  SPORT_EVENT_RESULTS_CHANGED: 'SPORT_EVENT_RESULTS_CHANGED',
  /**
   * A game of a sport event was decided: its result is in, a period score came after it, or it was
   * cancelled. Said by the match result write, an admin's or a provider's alike.
   */
  GAME_DECIDED: 'GAME_DECIDED',
  /**
   * A contest entry's week of picks for one event moved status: submitted, or sent back to draft by
   * a change its picks no longer pass (`PredictionService`). A pick saved without moving it is not one.
   */
  CONTEST_ENTRY_EVENT_STATUS_CHANGED: 'CONTEST_ENTRY_EVENT_STATUS_CHANGED',
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

export interface SportEventResultsChanged {
  type: typeof DomainEventType.SPORT_EVENT_RESULTS_CHANGED;
  sportEventId: string;
}

export interface GameDecided {
  type: typeof DomainEventType.GAME_DECIDED;
  sportEventId: string;
  /** The game, a `SportEventMatch`. */
  sportEventMatchId: string;
  /** When it was decided: the moment its contests settle at. */
  decidedAt: Date;
}


export interface ContestEntryEventStatusChanged {
  type: typeof DomainEventType.CONTEST_ENTRY_EVENT_STATUS_CHANGED;
  /** The entry's row for one event of its contest, by its ids. */
  contestEntryEvent: { contestId: string; contestEntryId: string; sportEventId: string };
  from: ContestEntryStatus;
  to: ContestEntryStatus;
}

/** Every domain event: one member per entity change, discriminated by `type`. */
export type DomainEvent = SportEventStatusChanged | SportEventRescheduled | SportEventResultsChanged | GameDecided | ContestEntryEventStatusChanged;

/** The member of `DomainEvent` whose type is `T`. */
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;
