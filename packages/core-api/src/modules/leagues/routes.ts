import type { FastifyInstance } from 'fastify';
import { listLeaguesHandler } from './handler';

export async function leaguesModule(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', listLeaguesHandler);

  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          maxMembers: { type: 'number', minimum: 2, maximum: 100 },
        },
      },
    },
    handler: async (_request, reply) => {
      return reply.status(501).send({ message: 'not implemented' });
    },
  });
}
