/**
 * Selection module — REST routes for roster-based selection.
 *
 * The route surface serves every selection type through its engine (tiered, budget pick and
 * random draw), plus the random draw's one commissioner action, running the draw.
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
import { leagueOfContest, requireCommissionerForContest, requireMemberOfLeague } from '../leagues/permissions';
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

const contestEntryEventParams = {
  type: 'object',
  required: ['contestId', 'entryId', 'sportEventId'],
  properties: {
    contestId: { type: 'string', format: 'uuid' },
    entryId: { type: 'string', format: 'uuid' },
    sportEventId: { type: 'string', format: 'uuid' },
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
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const contestRepo = new PrismaContestRepository(prisma);
  const requireContestLeagueMember = requireMemberOfLeague(membershipRepo, leagueOfContest(contestRepo));

  fastify.get('/:contestId', {
    schema: {
      tags: ['Selections'],
      summary: 'Get current selection state for a contest',
      description:
        'Returns the current selection-room state for one event of the contest (#713): `sportEventId`, else its next event that has not started, else its last; 404 CONTEST_EVENT_NOT_IN_CONTEST for an event the contest does not cover. It includes the event\'s field, its picks, and each entry\'s status in it. A budget contest lists the whole field as one group, dearest first, and carries `lineupSummary`: the viewed entry\'s spend against the salary cap. Active members of the contest\'s league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise. A DRAFT contest answers 404 CONTEST_NOT_FOUND to anyone but its league\'s commissioners and root admins. Until the event\'s picks are revealed (the contest is live and the event has started, or a random draw has dealt) the pick history carries only the caller\'s own entries, and entryId selects another squad\'s entry only once they are; otherwise it falls back to the caller\'s own. 409 CONTEST_EVENT_REQUIRED for a contest that covers no event.',
      operationId: 'getSelectionState',
      params: contestIdParams,
      querystring: schemaRef('SelectionStateQuery'),
      response: {
        200: schemaRef('SelectionStateResponse'),
        ...selectionErrorResponses(401, 403, 404, 409),
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
        'Submits a pick and returns the refreshed selection state for the pick\'s event: the event of the field row it names (#713). Picks are placed, swapped and unselected only while the contest is OPEN or ACTIVE and that event\'s start time has not passed: 409 CONTEST_ENTRY_LOCKED otherwise. In a budget contest re-selecting a held golfer unselects it, a golfer with no price is refused with 400 PRICE_MISSING, and the salary cap never refuses a pick: an entry may go over it while it rearranges. A change that leaves a SUBMITTED entry\'s lineup short, or over a budget contest\'s cap, sends the entry back to DRAFT; it must be submitted again to count.',
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

  fastify.post('/:contestId/entries/:entryId/events/:sportEventId/submit', {
    schema: {
      tags: ['Selections'],
      summary: 'Submit a contest entry\'s picks for one event',
      description:
        'Submits the caller\'s entry for one event of its contest (#713: "submit week 6", "submit your Masters picks") once that event\'s lineup is complete, and returns the refreshed selection state for that event. Each event of an entry starts as DRAFT and counts nowhere (leaderboard, standings, settlement, entry counts) until it is SUBMITTED. The lineup must hold the full roster with exactly each tier\'s picks: 409 ENTRY_LINEUP_INCOMPLETE otherwise. In a budget contest its picks must also cost no more than the salary cap: 409 ENTRY_OVER_BUDGET otherwise, reported only once the lineup is complete. Submitting an already submitted event changes nothing. A later pick change that leaves the lineup short or over the cap sends that event back to DRAFT. An event is submitted only while the contest is OPEN or ACTIVE and that event\'s start time has not passed: 409 CONTEST_ENTRY_LOCKED otherwise. 404 CONTEST_EVENT_NOT_IN_CONTEST for an event the contest does not cover. Only a member of the entry\'s squad may submit it: 403 ENTRY_ACCESS_DENIED otherwise.',
      operationId: 'submitContestEntry',
      params: contestEntryEventParams,
      response: {
        200: schemaRef('SelectionStateResponse'),
        ...selectionErrorResponses(400, 401, 403, 404, 409),
      },
    },
    handler: handlers.submitContestEntry,
  });

  fastify.post('/:contestId/draw', {
    schema: {
      tags: ['Selections'],
      summary: 'Run a random draw',
      description:
        'Runs a random-draw contest\'s draw and returns the refreshed selection state. Commissioner of the contest\'s league only (root admins bypass): 403 otherwise. The draw shuffles the event\'s available field and deals it round-robin, so every entry gets the contest\'s picksPerEntry; field members left over are not dealt. Every entry is submitted, entries close (no entering, leaving or renaming), and every entry\'s picks are visible to the league from then on. Final: there is no undo or redraw. The seed and dealt order are kept so the draw can be replayed. 409 CONTEST_NOT_RANDOM_DRAW for another selection type, CONTEST_DRAW_ALREADY_RUN once drawn, CONTEST_DRAW_NOT_OPEN unless the contest is OPEN, CONTEST_EVENT_ALREADY_STARTED once its event\'s start time has passed, CONTEST_DRAW_NO_ENTRIES with no entries, CONTEST_DRAW_FIELD_TOO_SMALL when the available field cannot deal every entry its picks, CONTEST_DRAW_ENTRIES_CHANGED when an entry came or went while the draw ran (nothing is dealt; run it again).',
      operationId: 'runContestDraw',
      params: contestIdParams,
      response: {
        200: schemaRef('SelectionStateResponse'),
        ...selectionErrorResponses(400, 401, 403, 404, 409),
      },
    },
    preHandler: requireCommissionerForContest(contestRepo, membershipRepo),
    handler: handlers.runContestDraw,
  });
}
