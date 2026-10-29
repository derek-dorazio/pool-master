import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import type { EventPageListQuery, EventPageListResponse } from '@poolmaster/shared/dto';
import { sendError } from '../../core/error-handler';
import type { ReadCache } from '../../core/read-cache';
import { toEventPageDto } from '../../mappers/event-pages.mapper';
import { EventPageNotFoundError, type EventPageService, type EventPageView } from './service';

/** The public reads this container computed lately (#1181): the lists by sport, the pages by address. */
export interface EventPageReadCaches {
  lists: ReadCache<EventPageView[]>;
  pages: ReadCache<EventPageView>;
}

export function createEventPageHandlers(service: EventPageService, caches: EventPageReadCaches) {
  return { listEventPages, getEventPage };

  async function listEventPages(
    request: FastifyRequest<{ Querystring: EventPageListQuery }>,
    _reply: FastifyReply,
  ): Promise<EventPageListResponse> {
    const { sport } = request.query;
    const pages = await caches.lists.get(sport ?? '', new Date(), () => service.listPages(sport));
    return { eventPages: pages.map(toEventPageDto) };
  }

  async function getEventPage(
    request: FastifyRequest<{ Params: { sport: Sport; pageSlug: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const { sport, pageSlug } = request.params;
      const page = await caches.pages.get(`${sport}/${pageSlug}`, new Date(), () => service.getPage(sport, pageSlug));
      return reply.send({ eventPage: toEventPageDto(page) });
    } catch (error) {
      if (error instanceof EventPageNotFoundError) {
        return sendError(reply, 404, error.code, error.message);
      }
      throw error;
    }
  }
}
