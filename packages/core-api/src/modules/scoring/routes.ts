/**
 * Scoring routes — leaderboard/scoring endpoints.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { ScoringConfigSchema } from '@poolmaster/shared/domain/scoring-config';
import {
  zodToJsonSchema,
  EntryScoreDetailResponseSchema,
  ParticipantScoreHistoryResponseSchema,
  RollupResultResponseSchema,
  ScoringConfigValidationResponseSchema,
  ScoringHealthResponseSchema,
  ScoringLeaderboardResponseSchema,
} from '@poolmaster/shared/dto';
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

function sendWithStatus(reply: FastifyReply, statusCode: number, payload: unknown) {
  return reply.status(statusCode).send(payload);
}

export async function scoringRoutes(
  app: FastifyInstance,
  options: ScoringRoutesOptions,
): Promise<void> {
  const handlerDeps = { scoringService: options.scoringService };

  /** Validate a ScoringConfig — parse with Zod and check stat keys. */
  app.post('/scoring/config/validate', {
    schema: {
      tags: ['Scoring'],
      summary: 'Validate a scoring configuration',
      operationId: 'validateScoringConfig',
      response: {
        200: zodToJsonSchema(ScoringConfigValidationResponseSchema),
        400: zodToJsonSchema(ScoringConfigValidationResponseSchema),
      },
    },
    handler: async (request, reply) => {
      const parseResult = ScoringConfigSchema.safeParse(request.body);

      if (!parseResult.success) {
        return sendWithStatus(reply, 400, {
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
        response: { 200: zodToJsonSchema(ScoringLeaderboardResponseSchema) },
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
        response: { 200: zodToJsonSchema(EntryScoreDetailResponseSchema) },
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
        response: { 200: zodToJsonSchema(ParticipantScoreHistoryResponseSchema) },
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
        response: { 200: zodToJsonSchema(RollupResultResponseSchema) },
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
      response: { 200: zodToJsonSchema(ScoringHealthResponseSchema) },
    },
  }, createGetHealthHandler(handlerDeps));
}
