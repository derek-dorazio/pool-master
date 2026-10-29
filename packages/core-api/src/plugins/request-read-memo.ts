import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { runWithReadMemo } from '../core/request-read-memo';

/**
 * Opens each request's read memo (#1176) before any other hook runs, so the permission gates,
 * plan gates, handler and services of one request share their point reads.
 *
 * Callback style on purpose: `runWithReadMemo(done)` makes every later hook and the handler run
 * inside the request's scope, which an async hook returning a promise cannot do.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- registered like the other plugins.
async function requestReadMemoPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onRequest', (_request, _reply, done) => {
    runWithReadMemo(done);
  });
}

export const requestReadMemo = fp(requestReadMemoPlugin, {
  name: 'request-read-memo',
  fastify: '5.x',
});
