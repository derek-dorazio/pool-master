/**
 * An event's field as readers read it (#1163, #1315): now, from this container's cache, or
 * batched for a fan-out. The field admin service answers its reads through this, and the contest
 * and email readers, which write nothing, are built with it alone.
 */

import type { FieldReadEvent, SportEventParticipantRepository, SportEventParticipantView, SportEventRepository } from '@poolmaster/shared/db';
import { eventPlaysField, type SportEvent } from '@poolmaster/shared/domain';
import { BatchedRead } from '../../core/batched-read';
import { ReadCache } from '../../core/read-cache';
import { SportEventError } from './errors';
import type { EventFieldCache } from './event-field-cache';

/** The event as a field read takes it (#2227): whether it plays FIELD is read from its slot definitions. */
export function fieldReadEventOf(event: Pick<SportEvent, 'id' | 'sportLeagueId' | 'slotDefinitions'>): FieldReadEvent {
  return { sportEventId: event.id, sportLeagueId: event.sportLeagueId, playsField: eventPlaysField(event) };
}

/** An event's field as readers read it: now, from this container's cache, or batched for a fan-out. */
export interface EventFieldReads {
  listEventParticipants(sportEventId: string): Promise<SportEventParticipantView[]>;
  listCachedEventParticipants(sportEventId: string): Promise<SportEventParticipantView[]>;
  batchedFieldReads(): EventFieldReads;
}

export interface EventFieldReaderDeps {
  sportEvents: Pick<SportEventRepository, 'findById' | 'findByIds'>;
  field: Pick<SportEventParticipantRepository, 'findFieldForEvent' | 'findFieldsForEvents'>;
  /** The fields read lately, shared by every reader in the container; a new one when omitted. */
  fieldCache?: EventFieldCache;
  now?: () => Date;
}

export class EventFieldReader implements EventFieldReads {
  private readonly fieldCache: EventFieldCache;

  constructor(private readonly deps: EventFieldReaderDeps) {
    this.fieldCache = deps.fieldCache ?? new ReadCache();
  }

  /**
   * The field in seed order, unseeded last, read now in one repository call (#1163). What a
   * write answers with, and what settlement and the emails read. 404 EVENT_NOT_FOUND for an
   * unknown event. Each row's valuation is the event's tier-set slot's, or that of the slot played in
   * `seasonSlotId` (#2044).
   */
  async listEventParticipants(sportEventId: string, seasonSlotId?: string): Promise<SportEventParticipantView[]> {
    const event = await this.deps.sportEvents.findById(sportEventId);
    if (!event) {
      throw new SportEventError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    return this.deps.field.findFieldForEvent(fieldReadEventOf(event), seasonSlotId);
  }

  /**
   * The same field, as viewers poll it (#1163): the one read in this container within the last
   * 30 seconds, else read now and kept. Every contest on the event shares it. A write through
   * the events routes or ingestion forgets it, so this container's next read is current.
   */
  listCachedEventParticipants(sportEventId: string): Promise<SportEventParticipantView[]> {
    return this.fieldCache.get(sportEventId, this.deps.now?.() ?? new Date(), () => this.listEventParticipants(sportEventId));
  }

  /**
   * The same two reads for one fan-out (#1315), batched: the fields asked for together are read
   * together, with their events, in the same few statements however many events. The cached
   * read still answers from this container's cache first.
   */
  batchedFieldReads(): EventFieldReads {
    const fields = new BatchedRead<string, SportEventParticipantView[]>(async (sportEventIds) => {
      const events = new Map((await this.deps.sportEvents.findByIds([...new Set(sportEventIds)])).map((event) => [event.id, event]));
      const missing = sportEventIds.find((sportEventId) => !events.has(sportEventId));
      if (missing !== undefined) {
        throw new SportEventError(`Sport event ${missing} was not found.`, 'EVENT_NOT_FOUND', 404);
      }
      const rows = await this.deps.field.findFieldsForEvents([...events.values()].map(fieldReadEventOf));
      return sportEventIds.map((sportEventId) => rows.filter((row) => row.entry.sportEventId === sportEventId));
    });
    const reads: EventFieldReads = {
      listEventParticipants: (sportEventId) => fields.load(sportEventId),
      listCachedEventParticipants: (sportEventId) => this.fieldCache.get(sportEventId, this.deps.now?.() ?? new Date(), () => fields.load(sportEventId)),
      batchedFieldReads: () => reads,
    };
    return reads;
  }
}
