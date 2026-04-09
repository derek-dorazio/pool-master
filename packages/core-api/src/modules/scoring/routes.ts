/**
 * Scoring routes — leaderboard/scoring endpoints.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { ScoringConfigSchema } from '@poolmaster/shared/domain/scoring-config';
import {
  zodToJsonSchema,
  EntryScoreDetailResponseSchema,
  ErrorEnvelopeSchema,
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

const scoringConfigValidationBodySchema = {
  type: 'object',
  required: ['sport', 'scoring_type'],
  properties: {
    contest_id: { type: 'string' },
    sport: { type: 'string' },
    scoring_type: {
      type: 'string',
      enum: ['CUMULATIVE', 'KNOCKOUT', 'BRACKET', 'STROKE_PLAY', 'POSITION'],
    },
    stat_rules: { type: 'array', items: { type: 'object', additionalProperties: true } },
    position_rules: { type: 'array', items: { type: 'object', additionalProperties: true } },
    bonus_rules: { type: 'array', items: { type: 'object', additionalProperties: true } },
    penalty_rules: { type: 'array', items: { type: 'object', additionalProperties: true } },
    multiplier_rules: { type: 'array', items: { type: 'object', additionalProperties: true } },
    bracket_round_rules: { type: 'array', items: { type: 'object', additionalProperties: true } },
    upset_bonus_config: {
      anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: true }],
    },
    special_slots: { type: 'array', items: { type: 'object', additionalProperties: true } },
    tiebreaker_config: { type: 'object', additionalProperties: true },
    missed_event_score: { type: 'number' },
    missed_event_points: { type: 'number' },
    dnf_handling: {
      type: 'string',
      enum: ['ZERO', 'EXCLUDE', 'LAST_PLACE', 'PENALTY', 'MISSED_CUT_SCORE'],
    },
    counting_method: {
      type: 'string',
      enum: ['ALL', 'BEST_N', 'DROP_LOWEST_N'],
    },
    best_n: { type: 'integer', minimum: 1 },
    drop_lowest_n: { type: 'integer', minimum: 1 },
    lower_is_better: { type: 'boolean' },
  },
} as const;

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
      body: scoringConfigValidationBodySchema,
      response: {
        200: zodToJsonSchema(ScoringConfigValidationResponseSchema),
        400: zodToJsonSchema(ScoringConfigValidationResponseSchema),
        500: zodToJsonSchema(ErrorEnvelopeSchema),
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
        response: {
          200: zodToJsonSchema(ScoringLeaderboardResponseSchema),
          500: zodToJsonSchema(ErrorEnvelopeSchema),
        },
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
        response: {
          200: zodToJsonSchema(EntryScoreDetailResponseSchema),
          500: zodToJsonSchema(ErrorEnvelopeSchema),
        },
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
        response: {
          200: zodToJsonSchema(ParticipantScoreHistoryResponseSchema),
          500: zodToJsonSchema(ErrorEnvelopeSchema),
        },
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
        response: {
          200: zodToJsonSchema(RollupResultResponseSchema),
          500: zodToJsonSchema(ErrorEnvelopeSchema),
        },
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
      response: {
        200: zodToJsonSchema(ScoringHealthResponseSchema),
        500: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
  }, createGetHealthHandler(handlerDeps));
}
