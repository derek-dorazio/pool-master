import fp from 'fastify-plugin';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { createRequestContextLogger } from '../core/logger';

declare module 'fastify' {
  interface FastifyRequest {
    contextLogger?: FastifyBaseLogger;
  }
}

// Kept fully async (plugin + both hooks), even though none of them await
// anything: converting all three to plain sync functions reproduces a real
// hang (not just a lint nit) when this plugin is registered alongside
// auth-guard's onRequest hook -- verified by reverting and re-running
// tests/unit/core-api/client-log-service.test.ts, which times out with the
// sync version and passes in ~60ms with this one. Root cause not fully
// isolated (Fastify/avvio hook-chaining interaction); reverting was the safe
// call. See eslint-disable comments below.
// eslint-disable-next-line @typescript-eslint/require-await
async function requestLoggingContextPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest('contextLogger', undefined);

  // eslint-disable-next-line @typescript-eslint/require-await -- see note above the plugin function.
  fastify.addHook('onRequest', async (request) => {
    request.contextLogger = createRequestContextLogger(request);
  });

  // eslint-disable-next-line @typescript-eslint/require-await -- see note above the plugin function.
  fastify.addHook('preHandler', async (request) => {
    request.contextLogger = createRequestContextLogger(request);
  });
}

export const requestLoggingContext = fp(requestLoggingContextPlugin, {
  name: 'request-logging-context',
  fastify: '5.x',
});
