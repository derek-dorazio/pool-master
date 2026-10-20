/**
 * Selection module — REST routes for roster-based selection.
 *
 * The route surface serves every roster selection type through its engine (tiered, budget pick
 * and random draw), plus the random draw's one commissioner action, running the draw, and a
 * prediction contest's game picks (#716): reading, saving, clearing and submitting one event's.
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
import { createPredictionService, createSelectionService, createSquaresService } from './wiring';
import { createSquaresHandlers } from './squares-handler';
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

const gamePickParams = {
  type: 'object',
  required: ['contestId', 'entryId', 'sportEventId', 'sportEventMatchId'],
  properties: {
    contestId: { type: 'string', format: 'uuid' },
    entryId: { type: 'string', format: 'uuid' },
    sportEventId: { type: 'string', format: 'uuid' },
    sportEventMatchId: { type: 'string', format: 'uuid' },
  },
} as const;

/** What saving or submitting a survivor week (#719) answers beyond any game-pick route's refusals. */
const SURVIVOR_PICK_REFUSALS = 'In a survivor contest (#719): 409 PREDICTION_ONE_PICK_REQUIRED unless the week holds exactly one pick; 409 PREDICTION_TEAM_ALREADY_USED for a team the entry picked in another submitted week; 409 PREDICTION_ENTRY_ELIMINATED once the entry is out.';

/** What every game-pick route answers for a contest, event, entry or game it can't serve (#716). */
const GAME_PICK_REFUSALS = '404 CONTEST_NOT_FOUND, CONTEST_EVENT_NOT_IN_CONTEST or CONTEST_ENTRY_NOT_FOUND; 409 CONTEST_FORMAT_MISMATCH for a roster contest, whose entries pick a lineup through the selection room.';

const contestEntryEventParams = {
  type: 'object',
  required: ['contestId', 'entryId', 'sportEventId'],
  properties: {
    contestId: { type: 'string', format: 'uuid' },
    entryId: { type: 'string', format: 'uuid' },
    sportEventId: { type: 'string', format: 'uuid' },
  },
} as const;

const squaresBoxParams = {
  type: 'object',
  required: ['contestId', 'rowIndex', 'columnIndex'],
  properties: {
    contestId: { type: 'string', format: 'uuid' },
    rowIndex: { type: 'integer', minimum: 0, maximum: 9 },
    columnIndex: { type: 'integer', minimum: 0, maximum: 9 },
  },
} as const;

/** What every squares route answers for a contest it can't serve (#711). */
const SQUARES_REFUSALS = '404 CONTEST_NOT_FOUND (a draft is shown only to its commissioners); 409 CONTEST_FORMAT_MISMATCH for a contest that is not squares.';

export function selectionsModule(fastify: FastifyInstance, opts: MailModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const handlers = createSelectionHandlers(createSelectionService(prisma, fastify.log, {
    mailDelivery: opts.mailDelivery,
    appBaseUrl: readApplicationBaseUrl(process.env),
  }), createPredictionService(prisma, fastify.log));
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

  fastify.get('/:contestId/entries/:entryId/events/:sportEventId/game-picks', {
    schema: {
      tags: ['Selections'],
      summary: 'Get a prediction contest entry\'s game picks for one event',
      description:
        `Returns one event's games, in game-number order and without cancelled games, with the entry's pick on each (#716). Active members of the contest's league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise. The entry's own squad sees every pick; anyone else sees a pick only once its game is revealed, at that game's kickoff once the contest is live (in a bracket, every pick at the event's start). Each game carries the teams really playing it and the teams the entry's own picks put in it (\`predictedHome\`, \`predictedAway\`): in a bracket (#721) a later game offers the teams the entry picked to win the games before it, paired by seed in a reseeded round. A bracket's picks also carry their outcome (CORRECT, BUSTED or PENDING) and points, and the entry its points, the most it can still reach, and its tiebreaker. ${GAME_PICK_REFUSALS}`,
      operationId: 'getGamePicks',
      params: contestEntryEventParams,
      response: {
        200: schemaRef('GamePicksResponse'),
        ...selectionErrorResponses(400, 401, 403, 404, 409),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: handlers.getGamePicks,
  });

  fastify.put('/:contestId/entries/:entryId/events/:sportEventId/game-picks', {
    schema: {
      tags: ['Selections'],
      summary: 'Save game picks',
      description:
        `Saves the caller's picks on one event's games, all or none, and returns the event's games with the entry's picks (#716). Each pick names a game and the team picked to win, and replaces the entry's pick on that game. In a bracket (#721) a pick must name a team the entry's picks put in the game (picks earlier in the same request count), and a later pick that no longer follows from them is cleared; the request may also set the event's \`tiebreakerValue\`, the total points of its tiebreaker game, a bracket's final or a week's last game (#717; 409 CONTEST_ENTRY_LOCKED once that game's pick has locked). A bracket's every pick locks at the event's start. Only a member of the entry's squad may save: 403 ENTRY_ACCESS_DENIED otherwise. Refused with 409 CONTEST_ENTRY_LOCKED unless the contest is OPEN or ACTIVE, and once the event's first game has started for a week still in draft (it doesn't count); 404 PREDICTION_GAME_NOT_FOUND for a game not in the event; 409 PREDICTION_GAME_STARTED once a game has kicked off; 400 PREDICTION_TEAM_NOT_IN_GAME for a team the game does not offer the entry; 409 PREDICTION_CONFIDENCE_INVALID for a confidence value in a straight-up pool, outside 1 to the week's game count, or, after the first kickoff, leaving a submitted week's values repeated. A value may repeat until the week is submitted. Before the first kickoff, a change that leaves a submitted week's confidence values invalid sends it back to DRAFT. ${SURVIVOR_PICK_REFUSALS} ${GAME_PICK_REFUSALS}`,
      operationId: 'saveGamePicks',
      params: contestEntryEventParams,
      body: schemaRef('SaveGamePicksRequest'),
      response: {
        200: schemaRef('GamePicksResponse'),
        ...selectionErrorResponses(400, 401, 403, 404, 409),
      },
    },
    handler: handlers.saveGamePicks,
  });

  fastify.delete('/:contestId/entries/:entryId/events/:sportEventId/game-picks/:sportEventMatchId', {
    schema: {
      tags: ['Selections'],
      summary: 'Clear a game pick',
      description:
        `Removes the caller's pick on one game and returns the event's games with the entry's picks (#716). Clearing a game with no pick changes nothing. In a bracket the later picks that followed from it are cleared too (#721). Before the event's first kickoff, clearing a pick of a submitted week sends it back to DRAFT. Refused as saving is, and with 409 PREDICTION_CLEAR_AFTER_FIRST_KICKOFF once the first game has started: a submitted week then stays submitted, and a pick on a game still to start can be changed to the other team but not cleared. In a survivor contest (#719), 409 PREDICTION_ENTRY_ELIMINATED once the entry is out. ${GAME_PICK_REFUSALS}`,
      operationId: 'clearGamePick',
      params: gamePickParams,
      response: {
        200: schemaRef('GamePicksResponse'),
        ...selectionErrorResponses(400, 401, 403, 404, 409),
      },
    },
    handler: handlers.clearGamePick,
  });

  fastify.post('/:contestId/entries/:entryId/events/:sportEventId/game-picks/submit', {
    schema: {
      tags: ['Selections'],
      summary: 'Submit an entry\'s game picks for one event',
      description:
        `Submits the caller's entry for one event ("submit week 6") and returns the event's games with the entry's picks (#716). Only a submitted event counts. Every game must be picked: 409 PREDICTION_WEEK_INCOMPLETE otherwise. In a confidence pool the values must be 1 to the game count, each used once: 409 PREDICTION_CONFIDENCE_INVALID otherwise. Every event needs its tiebreaker, a bracket's (#721) and a pick'em week's (#717): 409 PREDICTION_TIEBREAKER_MISSING otherwise. Submitting a submitted event changes nothing. Refused with 409 CONTEST_ENTRY_LOCKED unless the contest is OPEN or ACTIVE and the event's first game has not started. Only a member of the entry's team may submit: 403 ENTRY_ACCESS_DENIED otherwise. ${SURVIVOR_PICK_REFUSALS} ${GAME_PICK_REFUSALS}`,
      operationId: 'submitGamePicks',
      params: contestEntryEventParams,
      response: {
        200: schemaRef('GamePicksResponse'),
        ...selectionErrorResponses(400, 401, 403, 404, 409),
      },
    },
    handler: handlers.submitGamePicks,
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

  // --- Squares (#711) ---------------------------------------------------------------

  const squares = createSquaresHandlers(createSquaresService(prisma, fastify.log));

  fastify.get('/:contestId/squares', {
    schema: {
      tags: ['Selections'],
      summary: 'Read a squares contest\'s grid',
      description:
        `The grid of a squares contest (#711): each claimed box and its entry, the digits once drawn, the game with its score at the end of each period and its final result, each scoring moment's winning box (frozen once the contest is Final), and each entry's boxes and wins. Any member of the contest's league may read it. ${SQUARES_REFUSALS}`,
      operationId: 'getSquaresBoard',
      params: contestIdParams,
      response: {
        200: schemaRef('SquaresBoardResponse'),
        ...selectionErrorResponses(400, 401, 403, 404, 409),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: squares.getSquaresBoard,
  });

  fastify.put('/:contestId/squares/:rowIndex/:columnIndex', {
    schema: {
      tags: ['Selections'],
      summary: 'Claim a box of a squares grid',
      description:
        `Claims an empty box for an entry and returns the grid. A member claims for their own squad's entry; the commissioner (or a root admin) for any entry: 403 ENTRY_ACCESS_DENIED otherwise. 404 CONTEST_ENTRY_NOT_FOUND for an entry not in the contest. 409 SQUARES_CLAIMING_CLOSED unless the contest is OPEN, its numbers are not drawn and its game has not kicked off; SQUARES_BOX_TAKEN when someone holds the box; SQUARES_BOX_LIMIT_REACHED when the entry holds the contest's box limit. ${SQUARES_REFUSALS}`,
      operationId: 'claimSquaresBox',
      params: squaresBoxParams,
      body: schemaRef('ClaimSquaresBoxRequest'),
      response: {
        200: schemaRef('SquaresBoardResponse'),
        ...selectionErrorResponses(400, 401, 403, 404, 409),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: squares.claimSquaresBox,
  });

  fastify.delete('/:contestId/squares/:rowIndex/:columnIndex', {
    schema: {
      tags: ['Selections'],
      summary: 'Clear a box of a squares grid',
      description:
        `Clears a claimed box and returns the grid. Its holder's squad may clear it, and the commissioner (or a root admin) any box: 403 ENTRY_ACCESS_DENIED otherwise. 404 SQUARES_BOX_NOT_CLAIMED when nobody holds it. 409 SQUARES_CLAIMING_CLOSED under the same window as claiming. ${SQUARES_REFUSALS}`,
      operationId: 'clearSquaresBox',
      params: squaresBoxParams,
      response: {
        200: schemaRef('SquaresBoardResponse'),
        ...selectionErrorResponses(400, 401, 403, 404, 409),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: squares.clearSquaresBox,
  });

  fastify.post('/:contestId/squares/draw', {
    schema: {
      tags: ['Selections'],
      summary: 'Draw a squares contest\'s numbers',
      description:
        `Draws the digits 0 to 9 along each side of the grid, at random, and returns the grid. Commissioner of the contest's league only (root admins bypass): 403 otherwise. Claiming closes for good; every entry holding a box is submitted, and boxes nobody claimed stay empty. The seed is kept so the draw can be replayed. 409 SQUARES_ALREADY_DRAWN once drawn; SQUARES_DRAW_CLOSED unless the contest is OPEN or live and the game's first period score is not entered. ${SQUARES_REFUSALS}`,
      operationId: 'drawSquaresNumbers',
      params: contestIdParams,
      response: {
        200: schemaRef('SquaresBoardResponse'),
        ...selectionErrorResponses(400, 401, 403, 404, 409),
      },
    },
    preHandler: requireCommissionerForContest(contestRepo, membershipRepo),
    handler: squares.drawSquaresNumbers,
  });
}
