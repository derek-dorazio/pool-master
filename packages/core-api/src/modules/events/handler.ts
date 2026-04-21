import type { FastifyReply, FastifyRequest } from 'fastify';
import { toEventListResponse } from '../../mappers';
import type { EventService } from './service';

export function createEventHandlers(eventService: EventService) {
  return {
    listEvents,
  };

  async function listEvents(
    request: FastifyRequest<{
      Querystring: {
        sport?: string;
        status?: string;
        limit?: number;
      };
    }>,
    _reply: FastifyReply,
  ) {
    const logger = request.contextLogger ?? request.log;
    const query = request.query;

    logger.debug(
      {
        action: 'events.route.list.start',
        data: {
          sport: query.sport ?? null,
          status: query.status ?? null,
          limit: query.limit ?? null,
        },
      },
      'Handling list events request',
    );

    try {
      const events = await eventService.listEvents(query);
      const response = toEventListResponse(events);

      logger.info(
        {
          action: 'events.route.list.success',
          data: {
            count: response.events.length,
          },
        },
        'Listed events response',
      );

      logger.debug(
        {
          action: 'events.route.list.complete',
          data: {
            count: response.events.length,
          },
        },
        'Completed list events request',
      );

      return response;
    } catch (error) {
      logger.error(
        {
          action: 'events.route.list.failed',
          err: error,
          data: {
            sport: query.sport ?? null,
            status: query.status ?? null,
            limit: query.limit ?? null,
          },
        },
        'List events request failed',
      );
      throw error;
    }
  }
}
