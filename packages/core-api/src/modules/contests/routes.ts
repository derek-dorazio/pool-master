/**
 * Contests module — registers contest CRUD routes under /api/v1/leagues/:id/contests
 * and standalone contest routes under /api/v1/contests.
 */

import type { FastifyInstance } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components these routes $ref (#192).
import '@poolmaster/shared/dto/contests.dto';
// Registers ErrorEnvelope and SuccessResponse, which this module's routes $ref (#192).
import '@poolmaster/shared/dto';
import {
  PrismaContestRepository,
  PrismaLeagueMembershipRepository,
  PrismaSquadMembershipRepository,
} from '../../adapters';
import {
  requireCommissioner,
  requireCommissionerForContest,
  leagueFromPath,
  leagueOfContest,
  requireMemberOfLeague,
  requireOwnSquad,
} from '../leagues/permissions';
import { createContestService } from './wiring';
import { createContestHandlers, createCreateContestHandler } from './handler';
import { createContestManagementService } from '../contest-management/wiring';
import { getAppPrisma } from '../../core/prisma-context';
import { readApplicationBaseUrl, type MailModuleOptions } from '../email';

export function contestsModule(fastify: FastifyInstance, opts: MailModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const contestService = createContestService(prisma, fastify.log, {
    mailDelivery: opts.mailDelivery,
    appBaseUrl: readApplicationBaseUrl(process.env),
  });
  const handlers = createContestHandlers(contestService);
  const createContest = createCreateContestHandler(
    contestService,
    createContestManagementService(prisma, fastify.log),
  );

  // --- League-scoped contest routes (under /api/v1/leagues/:id/contests) ---
  // Note: These are registered under the leagues prefix, so :id = leagueId

  fastify.get('/', {
    schema: {
      tags: ['Contests'],
      summary: 'List contests for a league',
      description:
        "Returns the contests associated with the parent league so league-home and commissioner views can list current and historical contests. Each contest carries its entry count and its sport event's name and start, so a list needs no per-event reads. Active members of the league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.",
      operationId: 'listContests',
      response: {
        200: schemaRef('ContestListResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireMemberOfLeague(membershipRepo, leagueFromPath),
    handler: handlers.listContests,
  });

  fastify.post('/', {
    schema: {
      tags: ['Contests'],
      summary: 'Create a new contest in a league',
      description:
        'The one way a contest is created. Name a template, supply a configuration, or both: the template seeds the configuration and `configuration` replaces it. A request with neither is refused with 400 CONTEST_CONFIGURATION_REQUIRED — there is no platform default. A template that names a sport league (that league\'s own preset) makes contests only for that league\'s events: 422 CONTEST_CONFIG_TEMPLATE_LEAGUE_MISMATCH otherwise. Commissioners of the league only.',
      operationId: 'createContest',
      body: schemaRef('CreateContestRequest'),
      response: {
        201: schemaRef('ContestResponse'),
        400: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_CONFIGURATION_REQUIRED when neither `templateId` nor `configuration` is supplied; otherwise a request that does not match the schema.',
        },
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        409: {
          ...schemaRef('ErrorEnvelope'),
          description: 'Budget rules the event cannot run. CONTEST_EVENT_NOT_PRICED — the event\'s golfers have no prices, so there is no salary cap. CONTEST_BUDGET_UNFILLABLE — the cheapest golfers for every roster place cost more than the cap.',
        },
        422: {
          ...schemaRef('ErrorEnvelope'),
          description: 'The event, format or template cannot make this contest. The event: SPORT_EVENT_NOT_FOUND, SPORT_EVENT_NOT_RELEASED, SPORT_EVENT_FIELD_NOT_LOADED, SPORT_EVENT_ALREADY_STARTED. The format: CONTEST_FORMAT_NOT_ALLOWED. The selection type: CONTEST_SELECTION_TYPE_NOT_ALLOWED (the event\'s sport does not offer it). The configuration: CONTEST_RULES_SELECTION_TYPE_MISMATCH (rules of another selection type than the contest\'s), CONTEST_TIER_FIELD_OUT_OF_RANGE, CONTEST_BUDGET_FIELD_OUT_OF_RANGE (counted scores above the roster size), CONTEST_CONFIGURATION_INVALID (template missing, inactive, or for another format or selection type), or CONTEST_CONFIG_TEMPLATE_LEAGUE_MISMATCH (the template is one sport league\'s own preset and the event belongs to another league; a template with no sport league is offered for every league of its sport).',
        },
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: createContest,
  });
}

/**
 * Standalone contest routes — registered at /api/v1/contests for
 * operations that use contestId rather than leagueId.
 */
export function contestsByIdModule(fastify: FastifyInstance, opts: MailModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const contestService = createContestService(prisma, fastify.log, {
    mailDelivery: opts.mailDelivery,
    appBaseUrl: readApplicationBaseUrl(process.env),
  });
  const contestRepo = new PrismaContestRepository(prisma);
  const handlers = createContestHandlers(contestService);
  // Sage Pass 3 — the update and delete routes below change contest state on behalf of a
  // commissioner. The fastify-level auth guard only proves a valid session, not league
  // commissioner role. The contest-scoped helper resolves leagueId from the contest's row.
  const requireContestCommissioner = requireCommissionerForContest(
    contestRepo,
    membershipRepo,
  );
  // #193 — the read-only gate: any active member of the league that owns the contest. Every
  // route here either declares a gate or is on scripts/route-authorization-opt-outs.mjs with
  // the reason it authorizes elsewhere; `npm run rules:check` fails a route that does neither.
  const requireContestLeagueMember = requireMemberOfLeague(membershipRepo, leagueOfContest(contestRepo));
  // #458 — entering and leaving act for the caller's own squad, which the path does not name:
  // the gate finds it from the contest's league and the session.
  const requireOwnSquadInContestLeague = requireOwnSquad(
    membershipRepo,
    new PrismaSquadMembershipRepository(prisma),
    leagueOfContest(contestRepo),
  );

  // --- Contest CRUD ---
  fastify.get('/:contestId', {
    schema: {
      tags: ['Contests'],
      summary: 'Get a contest by ID',
      description:
        'Returns detailed contest information by contest ID for league, entry, and history surfaces that already know the contest identifier. Active members of the contest\'s league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.',
      operationId: 'getContest',
      response: {
        200: schemaRef('ContestResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: handlers.getContest,
  });

  fastify.get('/:contestId/entries', {
    schema: {
      tags: ['Contests'],
      summary: 'List contest entries',
      description:
        'Lists the contest entries currently registered for the contest, including data needed for administration and participant views. Active members of the contest\'s league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.',
      operationId: 'listContestEntries',
      response: {
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        200: schemaRef('ContestEntryListResponse'),
        400: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: handlers.listEntries,
  });

  fastify.get('/:contestId/entries/:entryId', {
    schema: {
      tags: ['Contests'],
      summary: 'Get contest entry detail',
      description:
        'Returns a contest entry plus its picked participants. Scores are exposed by the contest leaderboard endpoint rather than copied onto picks. Active members of the contest\'s league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.',
      operationId: 'getContestEntry',
      response: {
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        200: schemaRef('ContestEntryDetailResponse'),
        400: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: handlers.getEntry,
  });

  fastify.get('/:contestId/leaderboard', {
    schema: {
      tags: ['Contests'],
      summary: 'Get contest leaderboard',
      description:
        'Returns the member-facing leaderboard for a contest, as the cross-sport ContestLeaderboardResponse. Each entry carries its contest total and rank, its score and place in each of the contest\'s events whose picks are revealed (#713), and its picks in one shown event: `sportEventId`, else the latest revealed event. While an event is live, its entry standings are computed from the event\'s standings and joined to entry picks in memory, so picks remain pointers into `participants` (the shown event\'s own field rows). Once an event completes, its entries\' scores, ranks and pick counts come from the standings frozen when it settled, and once the contest is COMPLETED its totals come from the standings frozen at settlement, so a later score correction does not change a settled result; the event field still shows current scores. `scoringDefinitionId` names the scoring definition the leaderboard was ranked by; render scores and rounds through it. Active members of the contest\'s league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.',
      operationId: 'getContestLeaderboard',
      querystring: schemaRef('ContestLeaderboardQuery'),
      response: {
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        200: schemaRef('ContestLeaderboardResponse'),
        400: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_FORMAT_MISMATCH (a prediction contest: a bracket and a pick\'em pool have their own leaderboards, getBracketLeaderboard and getPickEmLeaderboard), CONTEST_EVENT_NOT_IN_CONTEST (the asked-for event is not one the contest covers), CONTEST_LEADERBOARD_PICKS_HIDDEN (no event\'s picks are revealed yet, or not the asked-for one\'s), _EVENT_REQUIRED, _COUNTING_RULE_MISSING, _SCORING_RULE_MISSING (the configuration carries no participant scoring rule), _SCORING_DEFINITION_UNKNOWN (its rule names a definition the registry does not know) or _SCORING_SETTINGS_INVALID (its rule\'s settings are not valid for that definition).',
        },
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: handlers.getLeaderboard,
  });

  fastify.get('/:contestId/bracket-leaderboard', {
    schema: {
      tags: ['Contests'],
      summary: 'Get a bracket contest leaderboard',
      description:
        'Returns a bracket contest\'s leaderboard (#721): each entry that submitted its bracket, with its points so far (a correct pick earns its round\'s value plus any upset bonus, under the contest\'s knockout round points), the most it can still reach (its points plus the round value of every pick whose team is still in), and its place. Entries level on points are ordered, once the final is played, by how close their tiebreaker was to the final\'s total points; entries still level share a place. Available once the event has started and picks are revealed. Once the contest is COMPLETED, points and places come from the standings frozen at settlement, so a later result correction does not change a settled place. Active members of the contest\'s league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.',
      operationId: 'getBracketLeaderboard',
      response: {
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        200: schemaRef('BracketLeaderboardResponse'),
        400: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_FORMAT_MISMATCH (not a bracket contest), CONTEST_LEADERBOARD_PICKS_HIDDEN (the event has not started), or CONTEST_LEADERBOARD_SCORING_RULE_MISSING, _SCORING_DEFINITION_UNKNOWN (its rule is not knockout round points) or _SCORING_SETTINGS_INVALID.',
        },
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: handlers.getBracketLeaderboard,
  });

  fastify.get('/:contestId/pick-em-leaderboard', {
    schema: {
      tags: ['Contests'],
      summary: 'Get a pick\'em contest leaderboard',
      description:
        'Returns a pick\'em contest\'s season leaderboard (#717): each entry that submitted at least one week, with its season total and, for each week, its points and place. A correct pick earns 1 point straight up, or its confidence value in a confidence pool; a pick on a lost game, a tie or a cancelled game earns nothing, and a week still in draft at its first kickoff scores nothing. Entries level on a week\'s points are ordered, once the week\'s last game is played, by how close their tiebreaker was to that game\'s total points; entries still level share the place. A week under way is scored live from its played games. Once a week settles, its points and places are frozen and its first-place entries are its winners; a later result correction changes nothing. Once the contest is COMPLETED, the season totals and places come from the standings frozen at settlement. Active members of the contest\'s league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.',
      operationId: 'getPickEmLeaderboard',
      response: {
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        200: schemaRef('PickEmLeaderboardResponse'),
        400: {
          ...schemaRef('ErrorEnvelope'),
          description: 'CONTEST_FORMAT_MISMATCH (not a pick\'em contest).',
        },
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: handlers.getPickEmLeaderboard,
  });

  fastify.post('/:contestId/entries/me', {
    schema: {
      tags: ['Contests'],
      summary: 'Create the current user contest entry',
      description:
        'Creates a new contest entry for the authenticated user. This route never returns an existing entry; clients should use the GET entry endpoints to inspect current entry state before or after creation. Entries change only while the contest is OPEN and before its event\'s scheduled start: 400 CONTEST_ENTRY_LOCKED otherwise. Acting for a squad needs an ACTIVE league membership and an ACTIVE squad membership: 403 LEAGUE_MEMBERSHIP_REQUIRED, LEAGUE_MEMBERSHIP_INACTIVE, SQUAD_MEMBERSHIP_INACTIVE, or SQUAD_MEMBERSHIP_REQUIRED when the caller has no squad.',
      operationId: 'enterContest',
      response: {
        201: schemaRef('ContestEntryResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        409: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireOwnSquadInContestLeague,
    handler: handlers.createMyEntry,
  });

  fastify.delete('/:contestId/entries/me', {
    schema: {
      tags: ['Contests'],
      summary: 'Delete the current user contest entry',
      description:
        'Deletes the authenticated user contest entry when the contest rules still allow the user to leave the contest: the contest is OPEN, its event has not reached its scheduled start, and the entry has no picks. Acting for a squad needs an ACTIVE league membership and an ACTIVE squad membership: 403 LEAGUE_MEMBERSHIP_REQUIRED, LEAGUE_MEMBERSHIP_INACTIVE, SQUAD_MEMBERSHIP_INACTIVE, or SQUAD_MEMBERSHIP_REQUIRED when the caller has no squad.',
      operationId: 'leaveContest',
      response: {
        200: schemaRef('ContestEntryDeletionResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireOwnSquadInContestLeague,
    handler: handlers.deleteMyEntry,
  });

  fastify.patch('/:contestId/entries/:entryId', {
    schema: {
      tags: ['Contests'],
      summary: 'Update a contest entry',
      description:
        'Updates mutable contest-entry fields such as name and tiebreaker prediction while the contest is OPEN and its event has not reached its scheduled start (400 CONTEST_ENTRY_LOCKED otherwise). Acting for a squad needs an ACTIVE league membership and an ACTIVE squad membership: 403 LEAGUE_MEMBERSHIP_REQUIRED, LEAGUE_MEMBERSHIP_INACTIVE, SQUAD_MEMBERSHIP_INACTIVE, or SQUAD_MANAGER_REQUIRED when the caller has no squad.',
      operationId: 'updateContestEntry',
      body: schemaRef('UpdateContestEntryRequest'),
      response: {
        200: schemaRef('ContestEntryResponse'),
        400: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    handler: handlers.updateEntry,
  });

  fastify.put('/:contestId', {
    schema: {
      tags: ['Contests'],
      summary: 'Update a contest',
      description:
        'Updates mutable contest fields for the target contest and returns the refreshed contest payload. Commissioners of the contest\'s league only (root admins bypass): 403 LEAGUE_PERMISSION_DENIED for a member who is not a commissioner, LEAGUE_MEMBERSHIP_REQUIRED for a non-member.',
      operationId: 'updateContest',
      body: schemaRef('UpdateContestRequest'),
      response: {
        200: schemaRef('ContestResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireContestCommissioner,
    handler: handlers.updateContest,
  });

  fastify.delete('/:contestId', {
    schema: {
      tags: ['Contests'],
      summary: 'Delete a contest',
      description:
        'Deletes the target contest when the contest is still DRAFT. Commissioners of the contest\'s league only (root admins bypass): 403 LEAGUE_PERMISSION_DENIED for a member who is not a commissioner, LEAGUE_MEMBERSHIP_REQUIRED for a non-member.',
      operationId: 'deleteContest',
      response: {
        200: schemaRef('SuccessResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireContestCommissioner,
    handler: handlers.deleteContest,
  });
}
