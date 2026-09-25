import type { FastifyInstance } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/events.dto';
import { getAppPrisma } from '../../core/prisma-context';
import { createEventHandlers } from './handler';
import { EventService } from './service';

export function eventsModule(fastify: FastifyInstance): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const eventService = new EventService(
    prisma.sportEvent,
    fastify.log.child({ module: 'events.service' }),
  );
  const handler = createEventHandlers(eventService);

  fastify.get('/', {
    schema: {
      tags: ['Events'],
      summary: 'List ingested sport events',
      description:
        'Returns ingested sport events so admin, scoring, and contest setup surfaces can browse the current event catalog.',
      operationId: 'listEvents',
      querystring: schemaRef('EventListQuery'),
      response: { 200: schemaRef('EventListResponse') },
    },
    handler: handler.listEvents,
  });
}
