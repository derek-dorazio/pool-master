import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import type { EventPageListQuery, EventPageListResponse } from '@poolmaster/shared/dto';
import { sendError } from '../../core/error-handler';
import { toEventPageDto } from '../../mappers/event-pages.mapper';
import { EventPageNotFoundError, type EventPageService } from './service';

export function createEventPageHandlers(service: EventPageService) {
  return { listEventPages, getEventPage };

  async function listEventPages(
    request: FastifyRequest<{ Querystring: EventPageListQuery }>,
    _reply: FastifyReply,
  ): Promise<EventPageListResponse> {
    const pages = await service.listPages(request.query.sport, request.query.upcoming ?? false);
    return { eventPages: pages.map(toEventPageDto) };
  }

  async function getEventPage(
    request: FastifyRequest<{ Params: { sport: Sport; pageSlug: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const page = await service.getPage(request.params.sport, request.params.pageSlug);
      return reply.send({ eventPage: toEventPageDto(page) });
    } catch (error) {
      if (error instanceof EventPageNotFoundError) {
        return sendError(reply, 404, error.code, error.message);
      }
      throw error;
    }
  }
}
