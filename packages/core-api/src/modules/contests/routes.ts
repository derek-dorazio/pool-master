/**
 * Contests module — registers contest CRUD routes under /api/v1/leagues/:id/contests
 * and standalone contest routes under /api/v1/contests.
 */

import type { FastifyInstance } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components these routes $ref (#192).
import '@poolmaster/shared/dto/contests.dto';
import { SuccessSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import {
  PrismaContestRepository,
  PrismaLeagueMembershipRepository,
} from '../../adapters';
import {
  requireCommissioner,
  requireCommissionerForContest,
  requireLeagueMembership,
  requireMemberOfLeague,
} from '../leagues/permissions';
import { createContestService } from './wiring';
import { OverrideService } from './override-service';
import { createContestHandlers, createCreateContestHandler } from './handler';
import { createContestManagementService } from '../contest-management/wiring';
import { createOverrideHandlers } from './override-handler';
import { getAppPrisma } from '../../core/prisma-context';
import {
  createMailDeliveryProvider,
  readApplicationBaseUrl,
  readMailDeliveryConfig,
} from '../email';

export function contestsModule(fastify: FastifyInstance): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const contestService = createContestService(prisma, fastify.log, {
    mailDelivery: createMailDeliveryProvider(readMailDeliveryConfig(process.env), fastify.log),
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
        'Returns the contests associated with the parent league so league-home and commissioner views can list current and historical contests. Active members of the league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.',
      operationId: 'listContests',
      response: {
        200: schemaRef('ContestListResponse'),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireLeagueMembership(membershipRepo),
    handler: handlers.listContests,
  });

  fastify.post('/', {
    schema: {
      tags: ['Contests'],
      summary: 'Create a new contest in a league',
      description:
        'The one way a contest is created. Name a template, supply a configuration, or both: the template seeds the configuration and `configuration` replaces it. A request with neither is refused with 400 CONTEST_CONFIGURATION_REQUIRED — there is no platform default. Commissioners of the league only.',
      operationId: 'createContest',
      body: schemaRef('CreateContestRequest'),
      response: {
        201: schemaRef('ContestResponse'),
        400: {
          ...zodToJsonSchema(ErrorEnvelopeSchema),
          description: 'CONTEST_CONFIGURATION_REQUIRED when neither `templateId` nor `configuration` is supplied; otherwise a request that does not match the schema.',
        },
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        422: {
          ...zodToJsonSchema(ErrorEnvelopeSchema),
          description: 'The event, format or template cannot make this contest. The event: SPORT_EVENT_NOT_FOUND, SPORT_EVENT_NOT_RELEASED, SPORT_EVENT_FIELD_NOT_LOADED, SPORT_EVENT_FIELD_LOCKED. The format: CONTEST_FORMAT_NOT_ALLOWED, CONTEST_FORMAT_NOT_SUPPORTED, CONTEST_SPORT_NOT_SUPPORTED. The configuration: CONTEST_TIER_FIELD_OUT_OF_RANGE, or CONTEST_CONFIGURATION_INVALID (template missing, inactive, or for another format or selection type).',
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
export function contestsByIdModule(fastify: FastifyInstance): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const contestService = createContestService(prisma, fastify.log, {
    mailDelivery: createMailDeliveryProvider(readMailDeliveryConfig(process.env), fastify.log),
    appBaseUrl: readApplicationBaseUrl(process.env),
  });
  const contestRepo = new PrismaContestRepository(prisma);
  const overrideService = new OverrideService(contestRepo);
  const handlers = createContestHandlers(contestService);
  const overrides = createOverrideHandlers(overrideService);
  // Sage Pass 3 — every override route below mutates contest state on
  // behalf of a commissioner. The fastify-level auth guard only proves a
  // valid session, not league commissioner role; without this gate any
  // authenticated user could call reopen / close / extend-deadline / etc.
  // The contest-scoped helper resolves leagueId from the contest's row.
  const requireContestCommissioner = requireCommissionerForContest(
    contestRepo,
    membershipRepo,
  );
  // #193 — the read-only gate: any active member of the league that owns the contest. Every
  // route here either declares a gate or is on scripts/route-authorization-opt-outs.mjs with
  // the reason it authorizes elsewhere; `npm run rules:check` fails a route that does neither.
  const requireContestLeagueMember = requireMemberOfLeague(contestRepo, membershipRepo);

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
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
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
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        200: schemaRef('ContestEntryListResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
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
        'Returns a contest entry plus its picked participants. Golf scoring data is exposed by the Golf leaderboard endpoint rather than copied onto picks. Active members of the contest\'s league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.',
      operationId: 'getContestEntry',
      response: {
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        200: schemaRef('ContestEntryDetailResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: handlers.getEntry,
  });

  fastify.get('/:contestId/golf/leaderboard', {
    schema: {
      tags: ['Contests'],
      summary: 'Get Golf contest leaderboard',
      description:
        'Returns the member-facing leaderboard for a golf contest, as the cross-sport ContestLeaderboardResponse. While the contest is live, entry standings are computed from the event\'s standings and joined to entry picks in memory, so picks remain pointers into `participants` (the event\'s own field rows). Once the contest is COMPLETED, each entry\'s total, rank, pick counts, the counting rule and asOf come from the standings frozen at settlement, so a later score correction does not change a settled result; the event field still shows current scores. `scoringDefinitionId` names the scoring definition the leaderboard was ranked by; render scores and rounds through it. Golf only today: another sport answers 400 _SPORT_UNSUPPORTED. Active members of the contest\'s league only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE otherwise.',
      operationId: 'getGolfContestLeaderboard',
      response: {
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        200: schemaRef('ContestLeaderboardResponse'),
        400: {
          ...zodToJsonSchema(ErrorEnvelopeSchema),
          description: 'CONTEST_GOLF_LEADERBOARD_PICKS_HIDDEN, _EVENT_REQUIRED, _SPORT_UNSUPPORTED, _COUNTING_RULE_MISSING, _SCORING_RULE_MISSING (the configuration carries no participant scoring rule) or _SCORING_DEFINITION_UNKNOWN (its rule names a definition the registry does not know).',
        },
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireContestLeagueMember,
    handler: handlers.getGolfLeaderboard,
  });

  fastify.get('/:contestId/entries/me', {
    schema: {
      tags: ['Contests'],
      summary: 'Get the current user contest entry',
      deprecated: true,
      description:
        'Deprecated legacy helper. New clients should use listContestEntries and filter entries by squadId/client context; this operation remains for older clients through the next release boundary.',
      operationId: 'getMyContestEntry',
      response: {
        200: schemaRef('MyContestEntryResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.getMyEntry,
  });

  fastify.post('/:contestId/entries/me', {
    schema: {
      tags: ['Contests'],
      summary: 'Create the current user contest entry',
      description:
        'Creates a new contest entry for the authenticated user. This route never returns an existing entry; clients should use the GET entry endpoints to inspect current entry state before or after creation. Acting for a squad needs an ACTIVE league membership and an ACTIVE squad membership: 403 LEAGUE_MEMBERSHIP_REQUIRED, LEAGUE_MEMBERSHIP_INACTIVE, SQUAD_MEMBERSHIP_INACTIVE, or SQUAD_MEMBERSHIP_REQUIRED when the caller has no team.',
      operationId: 'enterContest',
      response: {
        201: schemaRef('ContestEntryResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        409: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.createMyEntry,
  });

  fastify.delete('/:contestId/entries/me', {
    schema: {
      tags: ['Contests'],
      summary: 'Delete the current user contest entry',
      description:
        'Deletes the authenticated user contest entry when the contest rules still allow the user to leave the contest. Acting for a squad needs an ACTIVE league membership and an ACTIVE squad membership: 403 LEAGUE_MEMBERSHIP_REQUIRED, LEAGUE_MEMBERSHIP_INACTIVE, SQUAD_MEMBERSHIP_INACTIVE, or SQUAD_MANAGER_REQUIRED when the caller has no team.',
      operationId: 'leaveContest',
      response: {
        200: schemaRef('ContestEntryDeletionResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.deleteMyEntry,
  });

  fastify.patch('/:contestId/entries/:entryId', {
    schema: {
      tags: ['Contests'],
      summary: 'Update a contest entry',
      description:
        'Updates mutable contest-entry fields such as name and tiebreaker prediction while the contest is still joinable. Acting for a squad needs an ACTIVE league membership and an ACTIVE squad membership: 403 LEAGUE_MEMBERSHIP_REQUIRED, LEAGUE_MEMBERSHIP_INACTIVE, SQUAD_MEMBERSHIP_INACTIVE, or SQUAD_MANAGER_REQUIRED when the caller has no team.',
      operationId: 'updateContestEntry',
      body: schemaRef('UpdateContestEntryRequest'),
      response: {
        200: schemaRef('ContestEntryResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
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
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
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
        200: zodToJsonSchema(SuccessSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireContestCommissioner,
    handler: handlers.deleteContest,
  });

  // --- Contest Lifecycle Overrides ---
  fastify.post('/:contestId/reopen', {
    schema: {
      tags: ['Contests'],
      summary: 'Reopen a closed contest',
      description:
        'Reopens a previously closed contest so commissioner workflows can resume or correct the contest lifecycle.',
      operationId: 'reopenContest',
      response: { 200: schemaRef('ContestResponse') },
    },
    preHandler: requireContestCommissioner,
    handler: overrides.reopenContest,
  });
  fastify.post('/:contestId/close', {
    schema: {
      tags: ['Contests'],
      summary: 'Close a contest early',
      description:
        'Closes the contest ahead of its normal lifecycle when commissioner or admin action requires an early stop. '
        + 'A draft is refused with 409 CONTEST_CLOSE_STATUS_INVALID: open it to the league or delete it instead.',
      operationId: 'closeContest',
      response: { 200: schemaRef('ContestResponse') },
    },
    preHandler: requireContestCommissioner,
    handler: overrides.closeContest,
  });
  fastify.post('/:contestId/extend-deadline', {
    schema: {
      tags: ['Contests'],
      summary: 'Extend the contest end deadline',
      description:
        'Moves the contest deadline later to keep the contest open longer without recreating it.',
      operationId: 'extendContestDeadline',
      body: schemaRef('ExtendContestDeadlineRequest'),
      response: { 200: schemaRef('ContestResponse') },
    },
    preHandler: requireContestCommissioner,
    handler: overrides.extendDeadline,
  });
  fastify.post('/:contestId/update-lock', {
    schema: {
      tags: ['Contests'],
      summary: 'Update the contest lock time',
      description:
        'Changes the contest lock time that governs when picks or entries stop being editable.',
      operationId: 'updateContestLockTime',
      body: schemaRef('UpdateContestLockTimeRequest'),
      response: { 200: schemaRef('ContestResponse') },
    },
    preHandler: requireContestCommissioner,
    handler: overrides.updateLockTime,
  });
}
