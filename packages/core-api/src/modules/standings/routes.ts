/**
 * Standings module — registers leaderboard routes under /api/v1/contests/:contestId/standings.
 *
 * Routes:
 *   GET /                  — Full paginated leaderboard
 *   GET /summary           — Top N summary for dashboard widgets
 *   GET /my-entry          — Current user's entry with rank context
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { StandingsService } from './service';
import { createStandingsHandlers } from './handler';

export async function standingsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const standingsService = new StandingsService(prisma);
  const handlers = createStandingsHandlers(standingsService);

  // --- Full Leaderboard ---
  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string' },
          pageSize: { type: 'string' },
          sortBy: { type: 'string', enum: ['rank', 'score', 'name'] },
        },
      },
    },
    handler: handlers.getStandings,
  });

  // --- Top N Summary ---
  fastify.get('/summary', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          topN: { type: 'string' },
        },
      },
    },
    handler: handlers.getSummary,
  });

  // --- My Entry ---
  fastify.get('/my-entry', handlers.getMyEntry);
}
