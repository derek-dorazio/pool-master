/**
 * The Sport read (#236). Sports are seeded with the platform, so there is no write.
 * A root admin needs a sport's id to create a participant in it.
 */
import type { FastifyInstance } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import '@poolmaster/shared/dto/sport-catalog.dto';
import type { SportListResponse } from '@poolmaster/shared/dto/sport-catalog.dto';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaSportRepository } from '../../adapters';
import { mapSportToDto } from '../../mappers';

export function sportsModule(fastify: FastifyInstance): void {
  void fastify.register(schemaComponentsPlugin);
  const sports = new PrismaSportRepository(getAppPrisma(fastify));

  fastify.get('/', {
    schema: {
      tags: ['Sports'],
      summary: 'List sports',
      description: 'Every sport the platform runs contests on. Any signed-in user may read it.',
      operationId: 'listSports',
      response: { 200: schemaRef('SportListResponse') },
    },
    handler: async (): Promise<SportListResponse> => ({ sports: (await sports.findAll()).map(mapSportToDto) }),
  });
}
