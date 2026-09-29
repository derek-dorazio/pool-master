import type { FastifyInstance } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/events.dto';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaSportEventRepository } from '../../adapters';
import { createEventHandlers } from './handler';
import { EventService } from './service';

export function eventsModule(fastify: FastifyInstance): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const eventService = new EventService(
    new PrismaSportEventRepository(prisma),
    fastify.log.child({ module: 'events.service' }),
  );
  const handler = createEventHandlers(eventService);

  fastify.get('/', {
    schema: {
      tags: ['Events'],
      summary: 'List sport events',
      description:
        'The sport-event catalog, narrowed by sport and status and never paged. Any signed-in user may read it: '
        + 'contest setup picks an event from it, and a root admin browses it. Each event carries its loaded field '
        + 'size and contest-setup readiness.',
      operationId: 'listEvents',
      querystring: schemaRef('SportEventListQuery'),
      response: { 200: schemaRef('SportEventListResponse') },
    },
    handler: handler.listEvents,
  });
}
