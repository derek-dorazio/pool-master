import type { FastifyInstance } from 'fastify';
import { zodToJsonSchema } from '@poolmaster/shared/dto';
import {
  EventListResponseSchema,
  EventListQuerySchema,
} from '@poolmaster/shared/dto/events.dto';
import { getAppPrisma } from '../../core/prisma-context';
import { createEventHandlers } from './handler';
import { EventService } from './service';

export async function eventsModule(fastify: FastifyInstance): Promise<void> {
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
      querystring: zodToJsonSchema(EventListQuerySchema),
      response: { 200: zodToJsonSchema(EventListResponseSchema) },
    },
    handler: handler.listEvents,
  });
}
