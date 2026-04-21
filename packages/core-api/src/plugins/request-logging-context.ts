import fp from 'fastify-plugin';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { createRequestContextLogger } from '../core/logger';

declare module 'fastify' {
  interface FastifyRequest {
    contextLogger?: FastifyBaseLogger;
  }
}

async function requestLoggingContextPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest('contextLogger', undefined);

  fastify.addHook('onRequest', async (request) => {
    request.contextLogger = createRequestContextLogger(request);
  });

  fastify.addHook('preHandler', async (request) => {
    request.contextLogger = createRequestContextLogger(request);
  });
}

export const requestLoggingContext = fp(requestLoggingContextPlugin, {
  name: 'request-logging-context',
  fastify: '5.x',
});
