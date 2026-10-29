/**
 * Event pages module (#1007) — the public event pages, under /api/v1/event-pages: one event a fan
 * would name ("Championship Weekend") and its ways to play. Both reads are public: the pages are
 * platform reference data, identical for every viewer and tied to no league or user.
 */
import type { FastifyInstance } from 'fastify';
import { EVENT_PAGE_SLUG_PATTERN, Sport } from '@poolmaster/shared/domain';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
// Registers the named components these routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { getAppPrisma } from '../../core/prisma-context';
import { readPublicReadCacheTtlMs } from '../../core/public-cache';
import { ReadCache } from '../../core/read-cache';
import { createEventPageHandlers } from './handler';
import type { EventPageView } from './service';
import { createEventPageService } from './wiring';

const TAGS = ['Event pages'];
const PUBLIC = 'Public: no session is needed, and it holds nothing about any league or user.';

const PAGE_PARAMS = {
  type: 'object',
  required: ['sport', 'pageSlug'],
  properties: {
    sport: { type: 'string', enum: Object.values(Sport), description: 'The page\'s sport.' },
    pageSlug: { type: 'string', pattern: EVENT_PAGE_SLUG_PATTERN.source, description: 'The page\'s stored URL name, such as championship-weekend.' },
  },
} as const;

export function eventPagesModule(fastify: FastifyInstance): void {
  void fastify.register(schemaComponentsPlugin);
  // No write reaches these caches: the pages are seeded by migration, and an offer's edition and
  // whether it opens follow the events, so each task's copy is at most one TTL old (#1181).
  const ttlMs = readPublicReadCacheTtlMs(process.env);
  const handlers = createEventPageHandlers(createEventPageService(getAppPrisma(fastify), fastify.log), {
    lists: new ReadCache<EventPageView[]>(ttlMs),
    pages: new ReadCache<EventPageView>(ttlMs),
  });

  fastify.get('/', {
    schema: {
      tags: TAGS,
      summary: 'List event pages',
      description: `The active event pages, of one sport or every sport, each with its offers and their next editions, for How to Play's and the welcome page's Coming up row. ${PUBLIC}`,
      operationId: 'listEventPages',
      querystring: schemaRef('EventPageListQuery'),
      response: { 200: schemaRef('EventPageListResponse') },
    },
    handler: handlers.listEventPages,
  });

  fastify.get('/:sport/:pageSlug', {
    schema: {
      tags: TAGS,
      summary: 'Get an event page',
      description: `One event page by its sport and slug, active or retired: a retired page has no offers and names the page its URL redirects to, if any. Each offer carries its series' next edition that can still take the contest (the one under way, else the soonest upcoming) and whether Create contest would take it now (OPEN) or later (NOT_YET); an offer with no such edition is left out. 404 EVENT_PAGE_NOT_FOUND when no page has that address. ${PUBLIC}`,
      operationId: 'getEventPage',
      params: PAGE_PARAMS,
      response: { 200: schemaRef('EventPageResponse'), 404: schemaRef('ErrorEnvelope') },
    },
    handler: handlers.getEventPage,
  });
}
