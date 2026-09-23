import type { FastifyInstance } from 'fastify';

export function healthPlugin(fastify: FastifyInstance): void {
  fastify.get('/health', () => {
    return { status: 'ok', service: 'core-api' };
  });
}
