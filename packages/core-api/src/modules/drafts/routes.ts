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
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaContestRepository, PrismaLeagueMembershipRepository } from '../../adapters';
import { leagueOfContest, requireMemberOfLeague } from '../leagues/permissions';
import { createDraftHandlers } from './handler';
import { createDraftService } from './wiring';
import { readApplicationBaseUrl, type MailModuleOptions } from '../email';

const contestIdParams = {
  type: 'object',
  required: ['contestId'],
  properties: { contestId: { type: 'string', format: 'uuid' } },
} as const;

/** The error envelope under each status a route declares; one schema object per status. */
function draftErrorResponses(...statuses: number[]): Record<number, unknown> {
  const responses: Record<number, unknown> = {};
  for (const status of statuses) {
    responses[status] = schemaRef('ErrorEnvelope');
  }
  return responses;
}

const contestEntryParams = {
  type: 'object',
  required: ['contestId', 'entryId'],
  properties: {
    contestId: { type: 'string', format: 'uuid' },
    entryId: { type: 'string', format: 'uuid' },
  },
} as const;

export function draftsModule(fastify: FastifyInstance, opts: MailModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const handlers = createDraftHandlers(createDraftService(prisma, fastify.log, {
    mailDelivery: opts.mailDelivery,
    appBaseUrl: readApplicationBaseUrl(process.env),
  }));
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
        'Returns the current draft-room state for the contest, including queue, picks, timers, and selection availability. Active members of the contest\'s league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise. A DRAFT contest answers 404 CONTEST_NOT_FOUND to anyone but its league\'s commissioners and root admins. While the contest is DRAFT or OPEN the pick history carries only the caller\'s own entries, and entryId selects another team\'s entry only once picks are revealed (LOCKED onwards); otherwise it falls back to the caller\'s own.',
      operationId: 'getDraftState',
      params: contestIdParams,
      querystring: schemaRef('DraftStateQuery'),
      response: {
        200: schemaRef('DraftStateResponse'),
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
        'Submits a draft pick for the current turn and returns the refreshed draft state after the selection is processed. Picks are placed, swapped and unselected only while the contest is OPEN and its event\'s start time has not passed: 409 CONTEST_ENTRY_LOCKED otherwise. A change that leaves a SUBMITTED entry\'s lineup short sends the entry back to DRAFT; it must be submitted again to count.',
      operationId: 'submitContestSelection',
      params: contestIdParams,
      body: schemaRef('SubmitPickRequest'),
      response: {
        200: schemaRef('DraftPickResponse'),
        ...draftErrorResponses(400, 401, 403, 404, 409, 501),
      },
    },
    handler: handlers.submitContestSelection,
  });

  fastify.post('/:contestId/entries/:entryId/submit', {
    schema: {
      tags: ['Drafts'],
      summary: 'Submit a contest entry',
      description:
        'Submits the caller\'s entry once its lineup is complete, and returns the refreshed draft state. An entry starts as DRAFT and counts nowhere (leaderboard, standings, settlement, entry counts) until it is SUBMITTED. The lineup must hold the full roster with exactly each tier\'s picks: 409 ENTRY_LINEUP_INCOMPLETE otherwise. Submitting an already submitted entry changes nothing. A later pick change that leaves the lineup short sends the entry back to DRAFT. Entries are submitted only while the contest is OPEN and its event\'s start time has not passed: 409 CONTEST_ENTRY_LOCKED otherwise. Only a member of the entry\'s team may submit it: 403 DRAFT_ENTRY_ACCESS_DENIED otherwise.',
      operationId: 'submitContestEntry',
      params: contestEntryParams,
      response: {
        200: schemaRef('DraftStateResponse'),
        ...draftErrorResponses(400, 401, 403, 404, 409, 501),
      },
    },
    handler: handlers.submitContestEntry,
  });
}
