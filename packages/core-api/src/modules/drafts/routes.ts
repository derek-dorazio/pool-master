/**
 * Draft module — REST routes for roster-based selection.
 *
 * The route surface serves the independent selection modes (tiered and budget pick). Any
 * other configured SelectionType returns 501 DRAFT_MODE_UNSUPPORTED.
 *
 * Path, method, schema refs and wiring only (`docs/LAYERS.md` §2.7). The operations are in
 * `service.ts`, actor resolution and DTO mapping in `handler.ts`, the selection rules in
 * `draft-rules.ts`, the error codes in `draft-errors.ts` (#324).
 */

import type { FastifyInstance } from 'fastify';
import {
  zodToJsonSchema,
  DraftStateQuerySchema,
  DraftStateResponseSchema,
  DraftPickResponseSchema,
  ErrorEnvelopeSchema,
  SubmitPickRequestSchema,
} from '@poolmaster/shared/dto';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaContestRepository, PrismaLeagueMembershipRepository } from '../../adapters';
import { leagueOfContest, requireMemberOfLeague } from '../leagues/permissions';
import { createDraftHandlers } from './handler';
import { createDraftService } from './wiring';

const contestIdParams = {
  type: 'object',
  required: ['contestId'],
  properties: { contestId: { type: 'string', format: 'uuid' } },
} as const;

/** The error envelope under each status a route declares; one schema object per status. */
function draftErrorResponses(...statuses: number[]): Record<number, unknown> {
  const responses: Record<number, unknown> = {};
  for (const status of statuses) {
    responses[status] = zodToJsonSchema(ErrorEnvelopeSchema);
  }
  return responses;
}

export function draftsModule(fastify: FastifyInstance): void {
  const prisma = getAppPrisma(fastify);
  const handlers = createDraftHandlers(createDraftService(prisma, fastify.log));
  // #291 — the draft room shows every entry's picks, so reading it needs membership of the
  // contest's league, as every other contest read does.
  const requireContestLeagueMember = requireMemberOfLeague(
    new PrismaLeagueMembershipRepository(prisma),
    leagueOfContest(new PrismaContestRepository(prisma)),
  );

  fastify.get('/:contestId', {
    schema: {
      tags: ['Drafts'],
      summary: 'Get current draft state for a contest',
      description:
        'Returns the current draft-room state for the contest, including queue, picks, timers, and selection availability. Active members of the contest\'s league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.',
      operationId: 'getDraftState',
      params: contestIdParams,
      querystring: zodToJsonSchema(DraftStateQuerySchema),
      response: {
        200: zodToJsonSchema(DraftStateResponseSchema),
        ...draftErrorResponses(401, 403, 404, 501),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: handlers.getDraftState,
  });

  fastify.post('/:contestId/pick', {
    schema: {
      tags: ['Drafts'],
      summary: 'Submit a draft pick',
      description:
        'Submits a draft pick for the current turn and returns the refreshed draft state after the selection is processed.',
      operationId: 'submitContestSelection',
      params: contestIdParams,
      body: zodToJsonSchema(SubmitPickRequestSchema),
      response: {
        200: zodToJsonSchema(DraftPickResponseSchema),
        ...draftErrorResponses(400, 401, 403, 404, 501),
      },
    },
    handler: handlers.submitContestSelection,
  });
}
