/**
 * ETag/304 support plugin for Fastify.
 *
 * On response: computes MD5 hash of JSON body, sets ETag header.
 * On request: checks If-None-Match header against current ETag.
 * If match -> returns 304 Not Modified (no body, saves bandwidth).
 */

import fp from 'fastify-plugin';
import crypto from 'node:crypto';

export const etagPlugin = fp(async (app) => {
  app.addHook('onSend', async (request, reply, payload) => {
    // Only for GET requests with JSON responses
    if (request.method !== 'GET') return payload;
    if (!payload || typeof payload !== 'string') return payload;

    // Compute ETag from response body
    const hash = crypto.createHash('md5').update(payload).digest('hex');
    const etag = `"${hash}"`;

    reply.header('ETag', etag);
    reply.header('Cache-Control', 'no-cache'); // must revalidate

    // Check If-None-Match
    const ifNoneMatch = request.headers['if-none-match'];
    if (ifNoneMatch === etag) {
      reply.status(304);
      return ''; // empty body for 304
    }

    return payload;
  });
});
