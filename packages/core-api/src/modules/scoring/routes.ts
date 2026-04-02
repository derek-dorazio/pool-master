/**
 * Scoring routes — template library and leaderboard/scoring endpoints.
 */

import type { FastifyInstance } from 'fastify';
import { ScoringConfigSchema } from '@poolmaster/shared/domain/scoring-config';
import { getTemplate, listTemplates } from './templates/registry';
import { validateStatKeys } from './engine/stat-schemas';
import type { ScoringService } from './service';
import {
  createGetLeaderboardHandler,
  createGetEntryScoreHandler,
  createGetParticipantScoreHandler,
  createTriggerRollupHandler,
  createGetHealthHandler,
} from './handler';

export interface ScoringRoutesOptions {
  scoringService: ScoringService;
}

export async function scoringRoutes(
  app: FastifyInstance,
  options: ScoringRoutesOptions,
): Promise<void> {
  const handlerDeps = { scoringService: options.scoringService };

  // --- Template Routes ---

  /** List all available scoring templates. */
  app.get('/scoring/templates', {
    schema: {
      tags: ['Scoring'],
      summary: 'List available scoring templates',
      operationId: 'listScoringTemplates',
    },
    handler: async () => {
      return {
        templates: listTemplates(),
      };
    },
  });

  /** Get a specific template by key. Returns a mutable ScoringConfig. */
  app.get<{ Params: { key: string } }>('/scoring/templates/:key', {
    schema: {
      tags: ['Scoring'],
      summary: 'Get a scoring template by key',
      operationId: 'getScoringTemplate',
    },
    handler: async (request, reply) => {
      const { key } = request.params;
      const template = getTemplate(key);

      if (!template) {
        return reply.status(404).send({ error: `Template "${key}" not found` });
      }

      return {
        key,
        config: template,
      };
    },
  });

  /** Validate a ScoringConfig — parse with Zod and check stat keys. */
  app.post('/scoring/config/validate', {
    schema: {
      tags: ['Scoring'],
      summary: 'Validate a scoring configuration',
      operationId: 'validateScoringConfig',
    },
    handler: async (request, reply) => {
      const parseResult = ScoringConfigSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          valid: false,
          errors: parseResult.error.issues,
        });
      }

      const statErrors = validateStatKeys(parseResult.data);

      return {
        valid: statErrors.length === 0,
        config: parseResult.data,
        warnings: statErrors,
      };
    },
  });

  // --- Leaderboard & Scoring Routes ---

  /** Full leaderboard for a contest. */
  app.get<{ Params: { contestId: string } }>(
    '/scoring/contests/:contestId/leaderboard',
    {
      schema: {
        tags: ['Scoring'],
        summary: 'Get contest leaderboard',
        operationId: 'getContestLeaderboard',
      },
    },
    createGetLeaderboardHandler(handlerDeps),
  );

  /** Entry score breakdown. */
  app.get<{ Params: { contestId: string; entryId: string } }>(
    '/scoring/contests/:contestId/entry/:entryId',
    {
      schema: {
        tags: ['Scoring'],
        summary: 'Get entry score breakdown',
        operationId: 'getEntryScore',
      },
    },
    createGetEntryScoreHandler(handlerDeps),
  );

  /** Participant score history within a contest. */
  app.get<{ Params: { contestId: string; participantId: string } }>(
    '/scoring/contests/:contestId/participant/:participantId',
    {
      schema: {
        tags: ['Scoring'],
        summary: 'Get participant score history in a contest',
        operationId: 'getParticipantScore',
      },
    },
    createGetParticipantScoreHandler(handlerDeps),
  );

  /** Trigger manual standings rollup. */
  app.post<{ Params: { contestId: string } }>(
    '/scoring/contests/:contestId/rollup',
    {
      schema: {
        tags: ['Scoring'],
        summary: 'Trigger manual standings rollup',
        operationId: 'triggerStandingsRollup',
      },
    },
    createTriggerRollupHandler(handlerDeps),
  );

  /** Detailed health check. */
  app.get('/scoring/health', {
    schema: {
      tags: ['Scoring'],
      summary: 'Get scoring service health',
      operationId: 'getScoringHealth',
    },
  }, createGetHealthHandler(handlerDeps));
}
