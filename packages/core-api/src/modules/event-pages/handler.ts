import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import type { EventPageListQuery, EventPageListResponse } from '@poolmaster/shared/dto';
import { sendError } from '../../core/error-handler';
import { keepPublicUntil } from '../../core/public-cache';
import type { ReadCache } from '../../core/read-cache';
import { toEventPageDto } from '../../mappers/event-pages.mapper';
import { EventPageNotFoundError, eventPagesChangeAt, type EventPageService, type EventPageView } from './service';

/** The public reads this container computed lately (#1181): the lists by sport, the pages by address. */
export interface EventPageReadCaches {
  lists: ReadCache<EventPageView[]>;
  pages: ReadCache<EventPageView>;
}

/**
 * The value `cache` keeps for `key`, unless an offer in it has closed since it was computed: then
 * it is read afresh, so no task shows a closed contest as open (#1181).
 */
async function current<T>(cache: ReadCache<T>, key: string, views: (value: T) => EventPageView[], compute: () => Promise<T>): Promise<T> {
  const now = new Date();
  const kept = await cache.get(key, now, compute);
  const changeAt = eventPagesChangeAt(views(kept));
  if (changeAt === null || changeAt > now) return kept;
  cache.forget(key);
  return cache.get(key, now, compute);
}

export function createEventPageHandlers(service: EventPageService, caches: EventPageReadCaches) {
  return { listEventPages, getEventPage };

  async function listEventPages(
    request: FastifyRequest<{ Querystring: EventPageListQuery }>,
    reply: FastifyReply,
  ): Promise<EventPageListResponse> {
    const { sport } = request.query;
    const pages = await current(caches.lists, sport ?? '', (views) => views, () => service.listPages(sport));
    keepPublicUntil(reply, eventPagesChangeAt(pages));
    return { eventPages: pages.map(toEventPageDto) };
  }

  async function getEventPage(
    request: FastifyRequest<{ Params: { sport: Sport; pageSlug: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const { sport, pageSlug } = request.params;
      const page = await current(caches.pages, `${sport}/${pageSlug}`, (view) => [view], () => service.getPage(sport, pageSlug));
      keepPublicUntil(reply, eventPagesChangeAt([page]));
      return reply.send({ eventPage: toEventPageDto(page) });
    } catch (error) {
      if (error instanceof EventPageNotFoundError) {
        return sendError(reply, 404, error.code, error.message);
      }
      throw error;
    }
  }
}
