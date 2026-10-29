import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { REQUEST_QUERY_BUDGET, RequestQueryUsage, runWithQueryUsage } from '../core/request-query-usage';

declare module 'fastify' {
  interface FastifyRequest {
    /** The Prisma queries this request made so far (#1244). */
    queryUsage?: RequestQueryUsage;
  }
}

/**
 * Counts each request's Prisma queries (#1244). The request log line carries the count and the
 * time spent on them (the `res` serializer in core/logger.ts), and a request over
 * `REQUEST_QUERY_BUDGET` is logged as a warning with its route.
 *
 * Callback style on purpose, as in request-read-memo: `runWithQueryUsage(usage, done)` makes
 * every later hook and the handler run inside the request's scope.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- registered like the other plugins.
async function requestQueryUsagePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest('queryUsage', undefined);

  fastify.addHook('onRequest', (request, _reply, done) => {
    const usage = new RequestQueryUsage();
    request.queryUsage = usage;
    runWithQueryUsage(usage, done);
  });

  fastify.addHook('onResponse', (request, _reply, done) => {
    const usage = request.queryUsage;
    if (usage?.overBudget === true) {
      (request.contextLogger ?? request.log).warn({
        action: 'request.queryBudget.exceeded',
        data: { queryCount: usage.queryCount, dbMs: usage.dbMs, budget: REQUEST_QUERY_BUDGET },
      }, 'Request ran more queries than its budget');
    }
    done();
  });
}

export const requestQueryUsage = fp(requestQueryUsagePlugin, {
  name: 'request-query-usage',
  fastify: '5.x',
});
