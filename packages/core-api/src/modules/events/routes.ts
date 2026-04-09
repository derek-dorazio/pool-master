import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { zodToJsonSchema } from '@poolmaster/shared/dto';
import { EventListResponseSchema } from '@poolmaster/shared/dto/events.dto';
import { toEventListResponse } from '../../mappers';

export async function eventsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();

  fastify.get('/', {
    schema: {
      tags: ['Events'],
      summary: 'List ingested sport events',
      operationId: 'listEvents',
      querystring: {
        type: 'object',
        properties: {
          sport: { type: 'string' },
          status: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
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

      return toEventListResponse(events);
    },
  });
}
