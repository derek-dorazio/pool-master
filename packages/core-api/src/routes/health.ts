import type { FastifyInstance } from 'fastify';

export async function healthRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async () => {
    return { status: 'ok', service: 'core-api' };
  });
}
