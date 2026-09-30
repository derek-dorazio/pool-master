import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SportEventListQuery, SportEventListResponse } from '@poolmaster/shared/dto/events.dto';
import { mapSportEventToDto } from '../../mappers';
import type { EventService } from './service';

export function createEventHandlers(eventService: EventService) {
  return {
    listEvents,
  };

  async function listEvents(
    request: FastifyRequest<{ Querystring: SportEventListQuery }>,
    _reply: FastifyReply,
  ): Promise<SportEventListResponse> {
    const logger = request.contextLogger ?? request.log;
    const rows = await eventService.listEvents({ sport: request.query.sport, status: request.query.status });
    const events = rows.map(({ event, loadedParticipantCount }) => mapSportEventToDto(event, loadedParticipantCount));
    logger.info({
      action: 'events.route.list.success',
      data: { count: events.length, contestEligibleCount: events.filter((event) => event.contestEligible).length },
    }, 'Listed sport events');
    return { events };
  }
}
