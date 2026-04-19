import type { FastifyInstance } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import { zodToJsonSchema } from '@poolmaster/shared/dto';
import {
  EventListResponseSchema,
  EventListQuerySchema,
  type EventStatusDto,
} from '@poolmaster/shared/dto/events.dto';
import { toEventListResponse } from '../../mappers';
import { getAppPrisma } from '../../core/prisma-context';

export async function eventsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = getAppPrisma(fastify);

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
    async handler(request) {
      const query = request.query as { sport?: string; status?: string; limit?: number };
      const events = await prisma.sportEvent.findMany({
        where: {
          ...(query.sport ? { sport: query.sport } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: { startDate: 'asc' },
        take: query.limit ?? 25,
      });

      return toEventListResponse(
        events.map((event) => ({
          ...event,
          sport: event.sport as Sport,
          status: event.status as EventStatusDto,
          releaseAt: event.releaseAt,
          fieldLocksAt: event.fieldLocksAt,
          providerFieldLocked: event.fieldLocked,
        })),
      );
    },
  });
}
