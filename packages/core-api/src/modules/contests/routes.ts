import type { FastifyInstance } from 'fastify';

export async function contestsModule(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', async () => {
    return { contests: [] };
  });
}
