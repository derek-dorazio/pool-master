/**
 * Leagues module — registers all league, invitation, and member management routes.
 */

import type { FastifyInstance } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/leagues.dto';
import {
  zodToJsonSchema,
  SuccessSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import {
  PrismaLeagueRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueInvitationRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadRepository,
  PrismaContestRepository,
  PrismaActionItemRepository,
} from '../../adapters';
import { LeagueService } from './service';
import { InvitationService } from './invitation-service';
import { MemberService } from './member-service';
import { MemberDirectoryService } from './member-directory-service';
import { DashboardService } from './dashboard-service';
import { AuditService } from './audit-service';
import { BulkService } from './bulk-service';
import { requireCommissioner, requireLeagueMembership } from './permissions';
import { createLeagueHandlers } from './handler';
import { createInvitationHandlers } from './invitation-handler';
import { createMemberHandlers } from './member-handler';
import { createDashboardHandlers } from './dashboard-handler';
import { createAuditHandlers } from './audit-handler';
import { createBulkHandlers } from './bulk-handler';
import { getAppPrisma } from '../../core/prisma-context';
import {
  createMailDeliveryProvider,
  readApplicationBaseUrl,
  readMailDeliveryConfig,
} from '../email';

export function leaguesModule(fastify: FastifyInstance): void {
  // Routes below $ref named components, so they must be registered on this instance.
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const leagueRepo = new PrismaLeagueRepository(prisma);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const invitationRepo = new PrismaLeagueInvitationRepository(prisma);
  const squadRepo = new PrismaSquadRepository(prisma);
  const squadMembershipRepo = new PrismaSquadMembershipRepository(prisma);
  const contestRepo = new PrismaContestRepository(prisma);
  const actionItemRepo = new PrismaActionItemRepository(prisma);
  const mailDelivery = createMailDeliveryProvider(
    readMailDeliveryConfig(process.env),
    fastify.log,
  );
  const appBaseUrl = readApplicationBaseUrl(process.env);

  const leagueService = new LeagueService(
    leagueRepo,
    membershipRepo,
    squadRepo,
    squadMembershipRepo,
    prisma,
    fastify.log,
  );
  const invitationService = new InvitationService(
    invitationRepo,
    membershipRepo,
    leagueRepo,
    squadRepo,
    squadMembershipRepo,
    prisma,
    fastify.log,
    mailDelivery,
    appBaseUrl,
  );
  const memberService = new MemberService(
    membershipRepo,
    prisma,
    squadRepo,
    squadMembershipRepo,
    fastify.log,
  );
  const memberDirectoryService = new MemberDirectoryService(prisma);
  const dashboardService = new DashboardService(
    leagueRepo,
    membershipRepo,
    contestRepo,
    invitationRepo,
    actionItemRepo,
  );
  const auditService = new AuditService(prisma);
  const bulkService = new BulkService(
    contestRepo,
    leagueRepo,
    membershipRepo,
    invitationRepo,
  );

  const league = createLeagueHandlers(leagueService, membershipRepo);
  const invitation = createInvitationHandlers(invitationService);
  const member = createMemberHandlers(memberService, memberDirectoryService);
  const dashboard = createDashboardHandlers(dashboardService);
  const audit = createAuditHandlers(auditService);
  const bulk = createBulkHandlers(bulkService);

  // --- League CRUD ---

  fastify.get('/', {
    schema: {
      tags: ['Leagues'],
      summary: 'List leagues for the current user',
      description:
        'Returns the league summaries visible to the authenticated user. This list powers the welcome page, header selector, and richer My Leagues overview.',
      operationId: 'listLeagues',
      response: {
        200: schemaRef('LeagueListResponse'),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: league.listLeagues,
  });

  fastify.post('/', {
    schema: {
      tags: ['Leagues'],
      summary: 'Create a new league',
      description:
        'Creates a new private league for the authenticated commissioner using the submitted unique `leagueCode`, then returns the initial league detail payload.',
      operationId: 'createLeague',
      body: schemaRef('CreateLeagueRequest'),
      response: {
        201: schemaRef('LeagueResponse'),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        409: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: league.createLeague,
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Leagues'],
      summary: 'Get league details by ID',
      description:
        'Returns detailed league information by internal league ID for authenticated league members, league commissioners, or root admins using platform-level override access.',
      operationId: 'getLeague',
      response: {
        200: schemaRef('LeagueResponse'),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: league.getLeague,
  });

  fastify.get('/code/:leagueCode', {
    schema: {
      tags: ['Leagues'],
      summary: 'Get league details by league code',
      description:
        'Returns detailed league information by stable league code. This is the preferred route for bookmarkable `/league/<leagueCode>` web navigation and allows root-admin override access without faking league membership.',
      operationId: 'getLeagueByCode',
      response: {
        200: schemaRef('LeagueResponse'),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: league.getLeagueByCode,
  });

  fastify.put('/:id/details', {
    schema: {
      tags: ['Leagues'],
      summary: 'Update league details',
      description:
        'Allows a commissioner to edit the active league detail fields that are currently product truth: name and description. League code remains immutable after creation.',
      operationId: 'updateLeagueDetails',
      body: schemaRef('UpdateLeagueDetailsRequest'),
      response: {
        200: schemaRef('LeagueResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: league.updateLeagueDetails,
  });

  fastify.put('/:id/icon', {
    schema: {
      tags: ['Leagues'],
      summary: 'Update league icon',
      description:
        'Allows a commissioner to select a built-in league icon from the curated PoolMaster icon catalog. Custom uploads remain out of scope for this slice.',
      operationId: 'updateLeagueIcon',
      body: schemaRef('UpdateLeagueIconRequest'),
      response: {
        200: schemaRef('LeagueResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: league.updateLeagueIcon,
  });

  fastify.post('/:id/inactivate', {
    schema: {
      tags: ['Leagues'],
      summary: 'Inactivate a league',
      description:
        'Allows a commissioner to mark a league inactive. Inactive leagues remain visible, but this action is the required first step before a permanent delete becomes available.',
      operationId: 'inactivateLeague',
      response: {
        200: schemaRef('LeagueResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
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
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
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
        'Allows a commissioner to permanently delete an inactive league after typing the exact `leagueCode` confirmation. This removes league-owned data and relationships while preserving user accounts.',
      operationId: 'deleteLeague',
      body: schemaRef('DeleteLeagueRequest'),
      response: {
        200: zodToJsonSchema(SuccessSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
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
        'Creates direct email invitations for the target league. Existing members and pending duplicate invitees are reported separately in the response.',
      operationId: 'sendLeagueInvitations',
      body: schemaRef('SendLeagueInvitationsRequest'),
      response: {
        201: schemaRef('SendLeagueInvitationsResponse'),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        502: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: invitation.sendInvitations,
  });

  fastify.post('/:id/invite-link', {
    schema: {
      tags: ['Leagues'],
      summary: 'Generate a shareable invite link',
      description:
        'Creates a reusable invitation link for the target league. The resulting invite code is later previewed through the public invitation endpoints.',
      operationId: 'generateInviteLink',
      body: schemaRef('GenerateInviteLinkRequest'),
      response: {
        201: schemaRef('GenerateInviteLinkResponse'),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: invitation.generateInviteLink,
  });

  fastify.delete('/:id/invite-link/:code', {
    schema: {
      tags: ['Leagues'],
      summary: 'Revoke an invite link',
      description:
        'Revokes a previously created shareable invite link so the invite code can no longer be accepted by future users.',
      operationId: 'revokeInviteLink',
      response: {
        200: zodToJsonSchema(SuccessSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
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
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireLeagueMembership(membershipRepo),
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
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
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
        200: zodToJsonSchema(SuccessSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
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
        200: zodToJsonSchema(SuccessSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: member.leaveLeague,
  });

  // --- Commissioner Dashboard ---

  fastify.get('/:id/dashboard', {
    schema: {
      tags: ['Leagues'],
      summary: 'Get commissioner dashboard for a league',
      description:
        'Returns the commissioner-oriented dashboard payload for a league, including action items, member counts, pending invites, and upcoming events.',
      operationId: 'getLeagueDashboard',
      response: {
        200: schemaRef('LeagueDashboardResponse'),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: dashboard.getDashboard,
  });

  fastify.post('/:id/action-items/:itemId/resolve', {
    schema: {
      tags: ['Leagues'],
      summary: 'Resolve a commissioner action item',
      description:
        'Marks a commissioner action item as resolved and returns the updated action-item record for the league dashboard.',
      operationId: 'resolveActionItem',
      response: {
        200: schemaRef('ResolveActionItemResponse'),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: dashboard.resolveActionItem,
  });

  // --- Audit Log ---

  fastify.get('/:id/audit-log', {
    schema: {
      tags: ['Leagues'],
      summary: 'Get audit log for a league',
      description:
        'Returns the commissioner-visible audit log for league-level actions.',
      operationId: 'getLeagueAuditLog',
      response: {
        200: schemaRef('LeagueAuditEntriesResponse'),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: audit.getLeagueAuditLog,
  });

  fastify.get('/:id/audit-log/member', {
    schema: {
      tags: ['Leagues'],
      summary: 'Get audit log for a specific member',
      description:
        'Returns member-scoped audit information inside the league for commissioner or permitted member review surfaces.',
      operationId: 'getMemberAuditLog',
      response: {
        200: schemaRef('LeagueAuditEntriesResponse'),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireLeagueMembership(membershipRepo),
    handler: audit.getMemberAuditLog,
  });

  // --- Bulk Operations ---

  fastify.post('/:id/contests/copy-season', {
    schema: {
      tags: ['Leagues'],
      summary: 'Copy contests from a previous season',
      description:
        'Copies prior contest definitions into the current league so commissioners can bootstrap a new season from historical contests.',
      operationId: 'copySeason',
      body: schemaRef('CopySeasonRequest'),
      response: {
        201: schemaRef('LeagueBulkOperationResponse'),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: bulk.copySeason,
  });

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
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: bulk.importMembers,
  });
}
