import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import type { EventStatusDto } from '@poolmaster/shared/dto/events.dto';
import { sendError } from '../../core/error-handler';
import type { AdminEventBrowserService } from './event-browser-service';

export function createEventBrowserAdminHandlers(
  adminEventBrowserService: AdminEventBrowserService,
) {
  return {
    listEvents,
    listEventParticipants,
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
    const events = await adminEventBrowserService.listEvents({
      sport: request.query.sport as Sport | undefined,
      status: request.query.status as EventStatusDto | undefined,
      limit: request.query.limit,
    });

    return { events };
  }

  async function listEventParticipants(
    request: FastifyRequest<{
      Params: {
        eventId: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    const response = await adminEventBrowserService.listEventParticipants(
      request.params.eventId,
    );

    if (!response) {
      return sendError(reply, 404, 'EVENT_NOT_FOUND', 'Event not found');
    }

    return response;
  }
}
