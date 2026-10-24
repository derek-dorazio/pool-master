/**
 * Leagues module — registers all league, invitation, and member management routes.
 */

import type { FastifyInstance } from 'fastify';
import { PlanFeature } from '@poolmaster/shared/domain';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/leagues.dto';
// Registers ErrorEnvelope and SuccessResponse, which this module's routes $ref (#192).
import '@poolmaster/shared/dto';
import {
  PrismaContestRepository,
  PrismaLeagueRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueInvitationRepository,
  PrismaSquadMembershipRepository,
  PrismaMembershipTransaction,
  PrismaSportLeagueRepository,
  PrismaSquadRepository,
  PrismaUserRepository,
} from '../../adapters';
import { LeagueService } from './service';
import { InvitationService } from './invitation-service';
import { MemberService } from './member-service';
import { MemberDirectoryService } from './member-directory-service';
import { BulkService } from './bulk-service';
import {
  existingLeagueFromPath,
  leagueFromPath,
  requireCommissioner,
  requireMemberOfLeague,
} from './permissions';
import { createLeagueHandlers } from './handler';
import { createLeagueEventEmailSettingsHandler } from './event-email-settings-handler';
import { LeagueEventEmailSettingsService } from './event-email-settings-service';
import { createInvitationHandlers } from './invitation-handler';
import { createMemberHandlers } from './member-handler';
import { createBulkHandlers } from './bulk-handler';
import { getAppPrisma } from '../../core/prisma-context';
import { readApplicationBaseUrl, type MailModuleOptions } from '../email';
import { LeaguePlanService } from '../plans/league-plan-service';
import type { PlanModuleOptions } from '../plans/routes';
import { describePlanFeatureGate, requirePlanFeatures } from '../plans/plan-feature-gate';

export function leaguesModule(fastify: FastifyInstance, opts: MailModuleOptions & PlanModuleOptions): void {
  // Routes below $ref named components, so they must be registered on this instance.
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const leagueRepo = new PrismaLeagueRepository(prisma);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const invitationRepo = new PrismaLeagueInvitationRepository(prisma);
  const squadRepo = new PrismaSquadRepository(prisma);
  const squadMembershipRepo = new PrismaSquadMembershipRepository(prisma);
  const userRepo = new PrismaUserRepository(prisma);
  const email = opts.email;
  const appBaseUrl = readApplicationBaseUrl(process.env);

  const leagueService = new LeagueService({
    leagues: leagueRepo,
    memberships: membershipRepo,
    squads: squadRepo,
    squadMemberships: squadMembershipRepo,
    users: userRepo,
    prisma,
    logger: fastify.log,
  });
  const invitationService = new InvitationService({
    invitations: invitationRepo,
    memberships: membershipRepo,
    leagues: leagueRepo,
    squads: squadRepo,
    squadMemberships: squadMembershipRepo,
    users: userRepo,
    contests: new PrismaContestRepository(prisma),
    prisma,
    logger: fastify.log,
    email,
    appBaseUrl,
  });
  const memberService = new MemberService({
    leagueMemberships: membershipRepo,
    membershipTransaction: new PrismaMembershipTransaction(prisma),
    logger: fastify.log,
  });
  const memberDirectoryService = new MemberDirectoryService(membershipRepo, userRepo);
  const bulkService = new BulkService(
    leagueRepo,
    membershipRepo,
    invitationRepo,
  );

  const leaguePlanService = new LeaguePlanService({ leagues: leagueRepo, logger: fastify.log });
  const league = createLeagueHandlers(
    leagueService, membershipRepo, squadMembershipRepo, userRepo, opts.planEntitlements, leaguePlanService,
  );
  const updateLeagueEventEmailSettings = createLeagueEventEmailSettingsHandler(new LeagueEventEmailSettingsService({
    leagues: leagueRepo,
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    logger: fastify.log,
  }), opts.planEntitlements);
  const invitation = createInvitationHandlers(invitationService, userRepo);
  const member = createMemberHandlers(memberService, memberDirectoryService, userRepo);
  const bulk = createBulkHandlers(bulkService);

  // --- League CRUD ---

  fastify.get('/', {
    schema: {
      tags: ['Leagues'],
      summary: 'List leagues',
      description:
        'Returns leagues together with the viewer\'s own memberships once as an array. The leagues list is the one inherently multi-league surface, so it is the one place the viewer\'s relationship travels as a set rather than per row (access rule A8).\n\n`scope` selects which leagues: `mine` (the default) returns the leagues the caller belongs to and powers the welcome page, header selector and My Leagues overview; `all` returns every league on the platform and powers root-admin league management. `all` is the unscoped read access rule A1 permits to root admins only, and returns 403 otherwise. `search` and `isActive` narrow either scope.\n\nThis replaced `listLeagues` + `adminListLeagues`, which were one operation split by caller role.',
      operationId: 'listLeagues',
      querystring: schemaRef('LeagueListQuery'),
      response: {
        200: schemaRef('LeagueListResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    handler: league.listLeagues,
  });

  fastify.post('/', {
    schema: {
      tags: ['Leagues'],
      summary: 'Create a new league',
      description:
        'Creates a new private league for the authenticated commissioner using the submitted unique `leagueCode`, then returns the new league together with the creator\'s own membership edges in it.\n\nThe same `LeagueContextResponse` as `getLeague` and `getLeagueByCode`, because creating a league also creates the creator\'s COMMISSIONER membership: the client navigates straight into the league and seeds its context cache from this response rather than issuing a second read (access rule A8). `squadMembership` is null by construction — a league has no squads the instant it is created.',
      operationId: 'createLeague',
      body: schemaRef('CreateLeagueRequest'),
      response: {
        201: schemaRef('LeagueContextResponse'),
        401: schemaRef('ErrorEnvelope'),
        409: schemaRef('ErrorEnvelope'),
      },
    },
    handler: league.createLeague,
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Leagues'],
      summary: 'Get a league and the viewer\'s context in it, by ID',
      description:
        'Returns a league by internal league ID together with the viewer\'s own membership edges in it — their LeagueMembership and their SquadMembership — for authenticated league members, league commissioners, or root admins using platform-level override access.\n\nThe same `LeagueContextResponse` as `getLeagueByCode`: two ways to find one league, one response shape. Use this route when you hold a league ID rather than a league code, as contest-rooted surfaces do (access rule A8).\n\n404 LEAGUE_NOT_FOUND for a league that does not exist; otherwise active members only (root admins bypass): 403 LEAGUE_MEMBERSHIP_REQUIRED or LEAGUE_MEMBERSHIP_INACTIVE.',
      operationId: 'getLeague',
      response: {
        200: schemaRef('LeagueContextResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireMemberOfLeague(membershipRepo, existingLeagueFromPath(leagueRepo)),
    handler: league.getLeague,
  });

  fastify.get('/code/:leagueCode', {
    schema: {
      tags: ['Leagues'],
      summary: 'Get league details by league code',
      description:
        'The league-context call. Returns a league by its stable league code together with the viewer\'s own membership edges in it — their LeagueMembership and their SquadMembership. This is the preferred route for bookmarkable `/league/<leagueCode>` web navigation, it allows root-admin override access without faking league membership, and it is the one response that carries viewer context: every other league-scoped response omits it because the client already holds this one (access rule A8).',
      operationId: 'getLeagueByCode',
      response: {
        200: schemaRef('LeagueContextResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    handler: league.getLeagueByCode,
  });

  fastify.put('/:id/details', {
    schema: {
      tags: ['Leagues'],
      summary: 'Update league details',
      description:
        'Allows a commissioner to edit an active league\'s name, description and built-in icon in one request, so the change applies whole or not at all. League code remains immutable after creation.',
      operationId: 'updateLeagueDetails',
      body: schemaRef('UpdateLeagueDetailsRequest'),
      response: {
        200: schemaRef('LeagueResponse'),
        400: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: league.updateLeagueDetails,
  });

  fastify.put('/:id/cup-settings', {
    schema: {
      tags: ['Leagues'],
      summary: 'Update the league\'s championship settings',
      description:
        `Allows a commissioner to set an active league's championship name and points table (#841, #863) in one request. Cups score on read, so they follow the new table at once; the championship keeps the points each contest earned when it went final. 400 CUP_CUSTOM_POINTS_INVALID when CUSTOM has no points or another scale sends some; LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE for an inactive league. ${describePlanFeatureGate([PlanFeature.CUP_SETTINGS])} Changing hallOfLameVisible also needs RECORD_BOOK, the same 403 otherwise.`,
      operationId: 'updateLeagueCupSettings',
      body: schemaRef('UpdateLeagueCupSettingsRequest'),
      response: {
        200: schemaRef('LeagueResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: [requireCommissioner(membershipRepo), requirePlanFeatures(opts.planEntitlements, [PlanFeature.CUP_SETTINGS])],
    handler: league.updateLeagueCupSettings,
  });

  fastify.put('/:id/plan', {
    schema: {
      tags: ['Leagues'],
      summary: 'Change the league\'s plan',
      description:
        'Moves an active league to another plan (#945): any commissioner of the league, or a root admin, may pick any plan at any time, free, and it applies at once. Every change is logged with who made it; picking the plan the league is already on changes and logs nothing. A lower plan only stops new things: nothing the league already has is removed. Returns the league with its new `planEntitlements`. 400 LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE for an inactive league; 409 LEAGUE_PLAN_CHANGED when someone else changed the plan during this change, which then changes and logs nothing.',
      operationId: 'updateLeaguePlan',
      body: schemaRef('UpdateLeaguePlanRequest'),
      response: {
        200: schemaRef('LeagueResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
        409: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: league.updateLeaguePlan,
  });

  fastify.put('/:id/event-email-settings', {
    schema: {
      tags: ['Leagues'],
      summary: 'Choose which sport leagues\' upcoming events the commissioners are emailed about',
      description:
        'Allows a commissioner to set which sport leagues an active league\'s commissioners are not emailed about (#851): "Coming up soon" about 10 days before an event, and "Ready for contests" once it is released. The list is replaced whole; [] hears about every sport league, the default. 400 SPORT_LEAGUE_NOT_FOUND for an id that is not a sport league; LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE for an inactive league.',
      operationId: 'updateLeagueEventEmailSettings',
      body: schemaRef('UpdateLeagueEventEmailSettingsRequest'),
      response: {
        200: schemaRef('LeagueResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: updateLeagueEventEmailSettings,
  });

  fastify.post('/:id/inactivate', {
    schema: {
      tags: ['Leagues'],
      summary: 'Inactivate a league',
      description:
        'Marks a league inactive. Inactive leagues remain visible, but this action is the required first step before a permanent delete becomes available.\n\nOne operation for both callers: a commissioner of the league, or a root admin exercising platform authority. This replaced `inactivateLeague` + `adminInactivateLeague`.',
      operationId: 'inactivateLeague',
      response: {
        200: schemaRef('LeagueResponse'),
        400: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: league.inactivateLeague,
  });

  fastify.post('/:id/activate', {
    schema: {
      tags: ['Leagues'],
      summary: 'Activate a league',
      description:
        'Allows a commissioner to reactivate an inactive league so normal league usage and commissioner edits become available again.',
      operationId: 'activateLeague',
      response: {
        200: schemaRef('LeagueResponse'),
        400: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: league.activateLeague,
  });

  fastify.delete('/:id', {
    schema: {
      tags: ['Leagues'],
      summary: 'Delete an inactive league permanently',
      description:
        'Permanently deletes an inactive league after the caller types the exact `leagueCode` confirmation. This removes league-owned data and relationships while preserving user accounts.\n\nOne operation for both callers: a commissioner of the league, or a root admin exercising platform authority. This replaced `deleteLeague` + `adminDeleteLeague`.',
      operationId: 'deleteLeague',
      body: schemaRef('DeleteLeagueRequest'),
      response: {
        200: schemaRef('SuccessResponse'),
        400: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: league.deleteLeague,
  });

  // --- Invitations ---

  fastify.post('/:id/invitations', {
    schema: {
      tags: ['Leagues'],
      summary: 'Send email invitations to join a league',
      description:
        'Creates direct email invitations for the target league and queues each one\'s email; each sent invitation carries its email status. Existing members and pending duplicate invitees are reported separately in the response. An inactive league refuses with 400 `LEAGUE_INACTIVE`.',
      operationId: 'sendLeagueInvitations',
      body: schemaRef('SendLeagueInvitationsRequest'),
      response: {
        201: schemaRef('SendLeagueInvitationsResponse'),
        400: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: invitation.sendInvitations,
  });

  fastify.get('/:id/invitations', {
    schema: {
      tags: ['Leagues'],
      summary: 'List a league\'s outstanding invitations',
      description:
        'Lists the league\'s outstanding invitations, newest first: every PENDING email invite and join link, plus email invites that expired without being accepted, each email invite with where its latest email stands. Accepted and cancelled invitations are not listed. Commissioner only.',
      operationId: 'listLeagueInvitations',
      response: {
        200: schemaRef('ListLeagueInvitationsResponse'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: invitation.listInvitations,
  });

  fastify.post('/:id/invitations/:invitationId/resend', {
    schema: {
      tags: ['Leagues'],
      summary: 'Resend an email invitation',
      description:
        'Renews an outstanding email invitation: a new invite code (the old link stops working), a new expiry, and the invitation email queued again. 409 LEAGUE_INVITATION_NOT_RESENDABLE for a join link or an accepted or cancelled invitation, and 409 LEAGUE_INACTIVE while the league is inactive. Commissioner only.',
      operationId: 'resendLeagueInvitation',
      response: {
        200: schemaRef('ResendLeagueInvitationResponse'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
        409: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: invitation.resendInvitation,
  });

  fastify.post('/:id/invite-link', {
    schema: {
      tags: ['Leagues'],
      summary: 'Generate a shareable invite link',
      description:
        'Creates a reusable invitation link for the target league. The resulting invite code is later previewed through the public invitation endpoints. An inactive league refuses with 400 `LEAGUE_INACTIVE`.',
      operationId: 'generateInviteLink',
      body: schemaRef('GenerateInviteLinkRequest'),
      response: {
        201: schemaRef('GenerateInviteLinkResponse'),
        400: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: invitation.generateInviteLink,
  });

  fastify.delete('/:id/invite-link/:code', {
    schema: {
      tags: ['Leagues'],
      summary: 'Cancel an invitation',
      description:
        'Cancels an outstanding invitation by its invite code, a shareable join link or an email invite, so the code can no longer be accepted. The invitation becomes REVOKED. An invitation already accepted or cancelled is refused with 409 LEAGUE_INVITATION_NOT_CANCELLABLE.',
      operationId: 'revokeInviteLink',
      response: {
        200: schemaRef('SuccessResponse'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
        409: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: invitation.revokeInviteLink,
  });

  // --- Member Management ---

  fastify.get('/:id/members', {
    schema: {
      tags: ['Leagues'],
      summary: 'List league members',
      description:
        'Returns the current league membership list for authenticated members and commissioners. This powers member rosters and commissioner management surfaces.',
      operationId: 'listLeagueMembers',
      response: {
        200: schemaRef('LeagueMembersResponse'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireMemberOfLeague(membershipRepo, leagueFromPath),
    handler: member.listMembers,
  });

  fastify.put('/:id/members/:uid/role', {
    schema: {
      tags: ['Leagues'],
      summary: 'Change a member role and permissions',
      description:
        'Allows a commissioner to promote or demote a member within the league.',
      operationId: 'changeMemberRole',
      body: schemaRef('ChangeLeagueMemberRoleRequest'),
      response: {
        200: schemaRef('LeagueMembershipResponse'),
        400: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: member.changeRole,
  });

  fastify.delete('/:id/members/:uid', {
    schema: {
      tags: ['Leagues'],
      summary: 'Remove a member from the league',
      description:
        'Removes a member from the target league. Commissioners use this to manage league membership directly.',
      operationId: 'removeMember',
      response: {
        200: schemaRef('SuccessResponse'),
        400: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: member.removeMember,
  });

  fastify.delete('/:id/members/me', {
    schema: {
      tags: ['Leagues'],
      summary: 'Leave a league as the current member',
      description:
        'Allows the authenticated user to leave a league through their own membership rather than through a commissioner-managed removal flow.',
      operationId: 'leaveLeague',
      response: {
        200: schemaRef('SuccessResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    handler: member.leaveLeague,
  });

  /*
   * #202 — `resolveActionItem`, `getLeagueAuditLog` and `getMemberAuditLog` are GONE.
   *
   * All three were read/write APIs in front of features that were never built:
   *
   * - Nothing in the codebase ever created a `CommissionerActionItem`, so the resolve route
   *   could never have anything to resolve.
   * - Nothing ever wrote to the commissioner audit table — its one writer had zero callers —
   *   so both audit reads always returned an empty array. `getLeagueAuditLog` also took
   *   `limit`/`offset`, which §16 forbids.
   *
   * #255 then deleted the audit feature outright — both tables, every writer and every read —
   * and #205 dropped the action-item table and the dashboard's always-empty `actionItems`.
   *
   * #221 removed the commissioner dashboard (`getLeagueDashboard`) itself. It had no frontend
   * caller; its pending invites and join dates now live on Teams and Owners, and contest start
   * and end times on the contest pages.
   */

  /*
   * #202 — the copy-season operation is gone. It copied prior contest definitions into a league to bootstrap
   * a new season, had no frontend caller, and the repo owner removed it from scope.
   */

  fastify.post('/:id/members/import', {
    schema: {
      tags: ['Leagues'],
      summary: 'Bulk-import members via CSV rows',
      description:
        'Imports member rows for the league and creates invitations or memberships according to the validated bulk payload.',
      operationId: 'importMembers',
      body: schemaRef('ImportLeagueMembersRequest'),
      response: {
        201: schemaRef('LeagueBulkOperationResponse'),
        400: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: bulk.importMembers,
  });
}
