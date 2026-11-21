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

import type { ContestEntryStatus, ContestStatus, SportEvent, SportEventStatus } from '@poolmaster/shared/domain';
import type { ProviderBracketMatch, ProviderScheduledGame } from '../ingestion/core/provider-interface';

export const DomainEventType = {
  /** A sport event's status moved (`EventLifecycleService.applySportEventStatusTransition`). */
  SPORT_EVENT_STATUS_CHANGED: 'SPORT_EVENT_STATUS_CHANGED',
  /** A sport event's start moved, by an admin's edit that tells its leagues; each handler decides which statuses it acts on. */
  SPORT_EVENT_RESCHEDULED: 'SPORT_EVENT_RESCHEDULED',
  /**
   * A contest entry's week of picks for one event moved status: submitted, or sent back to draft by
   * a change its picks no longer pass (`PredictionService`). A pick saved without moving it is not one.
   */
  CONTEST_ENTRY_EVENT_STATUS_CHANGED: 'CONTEST_ENTRY_EVENT_STATUS_CHANGED',
  /** A contest's status moved (`ContestLifecycle`), one event per contest a guarded write moves. */
  CONTEST_STATUS_CHANGED: 'CONTEST_STATUS_CHANGED',
  /** A provider's field sync wrote a sport event's field (`IngestionPersistence.persistEventDetailWithDiagnostics`). */
  SPORT_EVENT_FIELD_SYNCED: 'SPORT_EVENT_FIELD_SYNCED',
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

export interface ContestEntryEventStatusChanged {
  type: typeof DomainEventType.CONTEST_ENTRY_EVENT_STATUS_CHANGED;
  /** The entry's row for one event of its contest, by its ids. */
  contestEntryEvent: { contestId: string; contestEntryId: string; sportEventId: string };
  from: ContestEntryStatus;
  to: ContestEntryStatus;
}

export interface ContestStatusChanged {
  type: typeof DomainEventType.CONTEST_STATUS_CHANGED;
  contest: { id: string };
  /**
   * The statuses the guarded write moves the contest from: it was in one of them, and a contest
   * in none is left where it is and queues nothing. A batch write cannot say which one each row
   * was in, so a handler reads `from` as the guard set: it acts on a move whose guard names the
   * status it reacts to, which assumes the guard names only statuses with the same follow-ups
   * (going live is from OPEN alone, a reopen from ACTIVE alone).
   */
  from: readonly ContestStatus[];
  to: ContestStatus;
  /** The sport event whose change moved the contest, when one did: its start took it live, or its postponement reopened it. */
  sportEventId?: string;
  /** The contest's start as the move sets it: when a reopened contest's picks close again. */
  startsAt?: Date;
}

export interface SportEventFieldSynced {
  type: typeof DomainEventType.SPORT_EVENT_FIELD_SYNCED;
  /** The event whose field was written, as the sync read it. */
  sportEvent: Pick<SportEvent, 'id' | 'status'>;
  /** The provider and its event id the field came from. */
  providerId: string;
  externalId: string;
  /** The provider's games of the event that came with the field, when it listed any (ADR 0011, #1728). */
  games?: readonly ProviderScheduledGame[];
  /** A fixed-shape playoff's whole bracket, when the provider gave one. */
  bracket?: readonly ProviderBracketMatch[];
}

/** Every domain event: one member per entity change, discriminated by `type`. */
export type DomainEvent = SportEventStatusChanged | SportEventRescheduled | ContestEntryEventStatusChanged | ContestStatusChanged | SportEventFieldSynced;

/** The member of `DomainEvent` whose type is `T`. */
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;
