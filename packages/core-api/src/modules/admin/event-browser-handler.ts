import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../../core/error-handler';
import type { AdminEventBrowserService } from './event-browser-service';

export function createEventBrowserAdminHandlers(
  adminEventBrowserService: AdminEventBrowserService,
) {
  return {
    listEventParticipants,
  };

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
