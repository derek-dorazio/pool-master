import type { FastifyInstance } from 'fastify';

export async function leaguesRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get('/leagues', async () => {
    return { leagues: [] };
  });

  fastify.post('/leagues', async (_request, reply) => {
    return reply.status(501).send({ message: 'not implemented' });
  });
}
