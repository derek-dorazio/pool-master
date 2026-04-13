/**
 * Config module — exposes runtime configuration for clients.
 *
 * Routes:
 *   GET /poll-intervals — Returns recommended poll intervals per surface
 */

import type { FastifyInstance } from 'fastify';
import { POLL_INTERVAL_CONFIG } from '../../plugins/poll-config';
import {
  PollIntervalConfigSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';

export async function configModule(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/config/poll-intervals
   *
   * Returns the full poll interval configuration as JSON so clients
   * can fetch recommended intervals on startup.
   *
   * Response:
   * {
   *   "standings": 10000,
   *   "draft": 10000,
   *   "contestStatus": 30000,
   *   "notifications": 30000,
   *   "default": 30000
   * }
   */
  fastify.get('/poll-intervals', {
    schema: {
      tags: ['Config'],
      summary: 'Get recommended poll intervals for clients',
      description:
        'Returns runtime poll-interval guidance for client surfaces such as standings, drafts, notifications, and other refresh-driven views.',
      operationId: 'getPollIntervals',
      response: { 200: zodToJsonSchema(PollIntervalConfigSchema) },
    },
    handler: async (_request, reply) => {
      return reply.send(POLL_INTERVAL_CONFIG);
    },
  });
}
