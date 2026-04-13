/**
 * Standings module — registers leaderboard routes under /api/v1/contests/:contestId/standings.
 *
 * Routes:
 *   GET /                  — Full paginated leaderboard
 *   GET /summary           — Top N summary for dashboard widgets
 *   GET /my-entry          — Current user's entry with rank context
 */

import type { FastifyInstance } from 'fastify';
import {
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import {
  StandingsResponseSchema,
  StandingsSummaryResponseSchema,
  MyStandingsEntryResponseSchema,
} from '@poolmaster/shared/dto/standings.dto';
import { StandingsService } from './service';
import { createStandingsHandlers } from './handler';
import { getAppPrisma } from '../../core/prisma-context';

export async function standingsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = getAppPrisma(fastify);
  const standingsService = new StandingsService(prisma);
  const handlers = createStandingsHandlers(standingsService);

  // --- Full Leaderboard ---
  fastify.get('/', {
    schema: {
      tags: ['Standings'],
      summary: 'Get the full paginated leaderboard',
      description:
        'Returns the full contest leaderboard with pagination support for standings pages and deep leaderboard browsing.',
      operationId: 'getStandings',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string' },
          pageSize: { type: 'string' },
          sortBy: { type: 'string', enum: ['rank', 'score', 'name'] },
        },
      },
      response: {
        200: zodToJsonSchema(StandingsResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.getStandings,
  });

  // --- Top N Summary ---
  fastify.get('/summary', {
    schema: {
      tags: ['Standings'],
      summary: 'Get top N standings summary for dashboard widgets',
      description:
        'Returns a compact top-of-leaderboard summary intended for widgets and dashboard-style standings previews.',
      operationId: 'getStandingsSummary',
      querystring: {
        type: 'object',
        properties: {
          topN: { type: 'string' },
        },
      },
      response: {
        200: zodToJsonSchema(StandingsSummaryResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.getSummary,
  });

  // --- My Entry ---
  fastify.get('/my-entry', {
    schema: {
      tags: ['Standings'],
      summary: 'Get the current user\'s entry with rank context',
      description:
        'Returns the authenticated user entry plus surrounding rank context so the user can see their standing without loading the full leaderboard.',
      operationId: 'getMyStandingsEntry',
      response: {
        200: zodToJsonSchema(MyStandingsEntryResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.getMyEntry,
  });
}
