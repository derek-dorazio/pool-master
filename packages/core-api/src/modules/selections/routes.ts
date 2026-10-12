/**
 * Selection module — REST routes for roster-based selection.
 *
 * The route surface serves every selection type through its engine (tiered and budget pick).
 *
 * Path, method, schema refs and wiring only (`docs/LAYERS.md` §2.7). The operations are in
 * `service.ts`, actor resolution and DTO mapping in `handler.ts`, the selection rules in
 * `selection-rules.ts`, the error codes in `selection-errors.ts` (#324).
 */

import type { FastifyInstance } from 'fastify';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaContestRepository, PrismaLeagueMembershipRepository } from '../../adapters';
import { leagueOfContest, requireMemberOfLeague } from '../leagues/permissions';
import { createSelectionHandlers } from './handler';
import { createSelectionService } from './wiring';
import { readApplicationBaseUrl, type MailModuleOptions } from '../email';

const contestIdParams = {
  type: 'object',
  required: ['contestId'],
  properties: { contestId: { type: 'string', format: 'uuid' } },
} as const;

/** The error envelope under each status a route declares; one schema object per status. */
function selectionErrorResponses(...statuses: number[]): Record<number, unknown> {
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

export function selectionsModule(fastify: FastifyInstance, opts: MailModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const handlers = createSelectionHandlers(createSelectionService(prisma, fastify.log, {
    mailDelivery: opts.mailDelivery,
    appBaseUrl: readApplicationBaseUrl(process.env),
  }));
  // #291 — the selection room shows every entry's picks, so reading it needs membership of the
  // contest's league, as every other contest read does.
  const requireContestLeagueMember = requireMemberOfLeague(
    new PrismaLeagueMembershipRepository(prisma),
    leagueOfContest(new PrismaContestRepository(prisma)),
  );

  fastify.get('/:contestId', {
    schema: {
      tags: ['Selections'],
      summary: 'Get current selection state for a contest',
      description:
        'Returns the current selection-room state for the contest, including queue, picks, timers, and selection availability. A budget contest lists the whole field as one group, dearest first, and carries `lineupSummary`: the viewed entry\'s spend against the salary cap. Active members of the contest\'s league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise. A DRAFT contest answers 404 CONTEST_NOT_FOUND to anyone but its league\'s commissioners and root admins. While the contest is DRAFT or OPEN the pick history carries only the caller\'s own entries, and entryId selects another team\'s entry only once picks are revealed (ACTIVE onwards); otherwise it falls back to the caller\'s own.',
      operationId: 'getSelectionState',
      params: contestIdParams,
      querystring: schemaRef('SelectionStateQuery'),
      response: {
        200: schemaRef('SelectionStateResponse'),
        ...selectionErrorResponses(401, 403, 404),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: handlers.getSelectionState,
  });

  fastify.post('/:contestId/pick', {
    schema: {
      tags: ['Selections'],
      summary: 'Submit a pick',
      description:
        'Submits a pick for the current turn and returns the refreshed selection state after the selection is processed. Picks are placed, swapped and unselected only while the contest is OPEN and its event\'s start time has not passed: 409 CONTEST_ENTRY_LOCKED otherwise. In a budget contest re-selecting a held golfer unselects it, a golfer with no price is refused with 400 PRICE_MISSING, and the salary cap never refuses a pick: an entry may go over it while it rearranges. A change that leaves a SUBMITTED entry\'s lineup short, or over a budget contest\'s cap, sends the entry back to DRAFT; it must be submitted again to count.',
      operationId: 'submitContestSelection',
      params: contestIdParams,
      body: schemaRef('SubmitPickRequest'),
      response: {
        200: schemaRef('SelectionPickResponse'),
        ...selectionErrorResponses(400, 401, 403, 404, 409),
      },
    },
    handler: handlers.submitContestSelection,
  });

  fastify.post('/:contestId/entries/:entryId/submit', {
    schema: {
      tags: ['Selections'],
      summary: 'Submit a contest entry',
      description:
        'Submits the caller\'s entry once its lineup is complete, and returns the refreshed selection state. An entry starts as DRAFT and counts nowhere (leaderboard, standings, settlement, entry counts) until it is SUBMITTED. The lineup must hold the full roster with exactly each tier\'s picks: 409 ENTRY_LINEUP_INCOMPLETE otherwise. In a budget contest its picks must also cost no more than the salary cap: 409 ENTRY_OVER_BUDGET otherwise, reported only once the lineup is complete. Submitting an already submitted entry changes nothing. A later pick change that leaves the lineup short or over the cap sends the entry back to DRAFT. Entries are submitted only while the contest is OPEN and its event\'s start time has not passed: 409 CONTEST_ENTRY_LOCKED otherwise. Only a member of the entry\'s team may submit it: 403 ENTRY_ACCESS_DENIED otherwise.',
      operationId: 'submitContestEntry',
      params: contestEntryParams,
      response: {
        200: schemaRef('SelectionStateResponse'),
        ...selectionErrorResponses(400, 401, 403, 404, 409),
      },
    },
    handler: handlers.submitContestEntry,
  });
}
