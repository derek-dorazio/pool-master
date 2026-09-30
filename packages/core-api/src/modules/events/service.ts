import type { FastifyBaseLogger } from 'fastify';
import type { SportEventFilters, SportEventRepository } from '@poolmaster/shared/db';
import type { SportEvent } from '@poolmaster/shared/domain';

/** An event and the one count its readiness is derived from. */
export interface SportEventWithField {
  event: SportEvent;
  loadedParticipantCount: number;
}

export class EventService {
  constructor(
    private readonly sportEvents: SportEventRepository,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /** The whole catalog for the filters — narrowed, never paged (§16). */
  async listEvents(filters: SportEventFilters): Promise<SportEventWithField[]> {
    this.logger?.debug({ action: 'events.list.start', data: { ...filters } }, 'Listing sport events');
    const events = await this.sportEvents.findAll(filters);
    const counts = await this.sportEvents.countParticipants(events.map((event) => event.id));
    this.logger?.info({ action: 'events.list.success', data: { ...filters, count: events.length } }, 'Listed sport events');
    return events.map((event) => ({ event, loadedParticipantCount: counts.get(event.id) ?? 0 }));
  }
}
