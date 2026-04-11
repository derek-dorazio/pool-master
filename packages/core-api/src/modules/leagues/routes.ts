/**
 * Leagues module — registers all league, invitation, and member management routes.
 */

import type { FastifyInstance } from 'fastify';
import { CommissionerPermission } from '@poolmaster/shared/domain';
import {
  CreateLeagueRequestSchema,
  LeagueAuditEntriesResponseSchema,
  LeagueBulkOperationResponseSchema,
  LeagueDashboardResponseSchema,
  zodToJsonSchema,
  GenerateInviteLinkRequestSchema,
  GenerateInviteLinkResponseSchema,
  ImportLeagueMembersRequestSchema,
  LeagueListResponseSchema,
  LeagueMembershipResponseSchema,
  LeagueResponseSchema,
  ResolveActionItemResponseSchema,
  SendLeagueInvitationsRequestSchema,
  SendLeagueInvitationsResponseSchema,
  SuccessSchema,
  ChangeLeagueMemberRoleRequestSchema,
  CopySeasonRequestSchema,
  LeagueMembersResponseSchema,
  UpdateLeagueSettingsRequestSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import {
  PrismaLeagueRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueInvitationRepository,
  PrismaContestRepository,
  PrismaActionItemRepository,
} from '../../adapters';
import { requirePermission } from '../../core/require-permission';
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

export async function leaguesModule(fastify: FastifyInstance): Promise<void> {
  const prisma = getAppPrisma(fastify);
  const leagueRepo = new PrismaLeagueRepository(prisma);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const invitationRepo = new PrismaLeagueInvitationRepository(prisma);
  const contestRepo = new PrismaContestRepository(prisma);
  const actionItemRepo = new PrismaActionItemRepository(prisma);

  const leagueService = new LeagueService(leagueRepo, membershipRepo);
  const invitationService = new InvitationService(invitationRepo, membershipRepo, leagueRepo);
  const memberService = new MemberService(membershipRepo);
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

  const league = createLeagueHandlers(leagueService);
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
      operationId: 'listLeagues',
      response: {
        200: zodToJsonSchema(LeagueListResponseSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: league.listLeagues,
  });

  fastify.post('/', {
    schema: {
      tags: ['Leagues'],
      summary: 'Create a new league',
      operationId: 'createLeague',
      body: zodToJsonSchema(CreateLeagueRequestSchema),
      response: {
        201: zodToJsonSchema(LeagueResponseSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: league.createLeague,
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Leagues'],
      summary: 'Get league details by ID',
      operationId: 'getLeague',
      response: {
        200: zodToJsonSchema(LeagueResponseSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: league.getLeague,
  });

  fastify.get('/code/:leagueCode', {
    schema: {
      tags: ['Leagues'],
      summary: 'Get league details by league code',
      operationId: 'getLeagueByCode',
      response: {
        200: zodToJsonSchema(LeagueResponseSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: league.getLeagueByCode,
  });

  fastify.put('/:id/settings', {
    schema: {
      tags: ['Leagues'],
      summary: 'Update league settings',
      operationId: 'updateLeagueSettings',
      body: zodToJsonSchema(UpdateLeagueSettingsRequestSchema),
      response: {
        200: zodToJsonSchema(LeagueResponseSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requirePermission(membershipRepo, CommissionerPermission.LEAGUE_SETTINGS_EDIT),
    handler: league.updateSettings,
  });

  // --- Invitations ---

  fastify.post('/:id/invitations', {
    schema: {
      tags: ['Leagues'],
      summary: 'Send email invitations to join a league',
      operationId: 'sendLeagueInvitations',
      body: zodToJsonSchema(SendLeagueInvitationsRequestSchema),
      response: {
        201: zodToJsonSchema(SendLeagueInvitationsResponseSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requirePermission(membershipRepo, CommissionerPermission.LEAGUE_MEMBERS_INVITE),
    handler: invitation.sendInvitations,
  });

  fastify.post('/:id/invite-link', {
    schema: {
      tags: ['Leagues'],
      summary: 'Generate a shareable invite link',
      operationId: 'generateInviteLink',
      body: zodToJsonSchema(GenerateInviteLinkRequestSchema),
      response: {
        201: zodToJsonSchema(GenerateInviteLinkResponseSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requirePermission(membershipRepo, CommissionerPermission.LEAGUE_MEMBERS_INVITE),
    handler: invitation.generateInviteLink,
  });

  fastify.delete('/:id/invite-link/:code', {
    schema: {
      tags: ['Leagues'],
      summary: 'Revoke an invite link',
      operationId: 'revokeInviteLink',
      response: {
        200: zodToJsonSchema(SuccessSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requirePermission(membershipRepo, CommissionerPermission.LEAGUE_MEMBERS_INVITE),
    handler: invitation.revokeInviteLink,
  });

  // --- Member Management ---

  fastify.get('/:id/members', {
    schema: {
      tags: ['Leagues'],
      summary: 'List league members',
      operationId: 'listLeagueMembers',
      response: {
        200: zodToJsonSchema(LeagueMembersResponseSchema),
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
      operationId: 'changeMemberRole',
      body: zodToJsonSchema(ChangeLeagueMemberRoleRequestSchema),
      response: {
        200: zodToJsonSchema(LeagueMembershipResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requirePermission(
      membershipRepo,
      CommissionerPermission.LEAGUE_MEMBERS_ROLE_CHANGE,
    ),
    handler: member.changeRole,
  });

  fastify.delete('/:id/members/:uid', {
    schema: {
      tags: ['Leagues'],
      summary: 'Remove a member from the league',
      operationId: 'removeMember',
      response: {
        200: zodToJsonSchema(SuccessSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requirePermission(membershipRepo, CommissionerPermission.LEAGUE_MEMBERS_REMOVE),
    handler: member.removeMember,
  });

  fastify.delete('/:id/members/me', {
    schema: {
      tags: ['Leagues'],
      summary: 'Leave a league as the current member',
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
      operationId: 'getLeagueDashboard',
      response: {
        200: zodToJsonSchema(LeagueDashboardResponseSchema),
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
      operationId: 'resolveActionItem',
      response: {
        200: zodToJsonSchema(ResolveActionItemResponseSchema),
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
      operationId: 'getLeagueAuditLog',
      response: {
        200: zodToJsonSchema(LeagueAuditEntriesResponseSchema),
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
      operationId: 'getMemberAuditLog',
      response: {
        200: zodToJsonSchema(LeagueAuditEntriesResponseSchema),
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
      operationId: 'copySeason',
      body: zodToJsonSchema(CopySeasonRequestSchema),
      response: {
        201: zodToJsonSchema(LeagueBulkOperationResponseSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requirePermission(membershipRepo, CommissionerPermission.CONTEST_CREATE),
    handler: bulk.copySeason,
  });

  fastify.post('/:id/members/import', {
    schema: {
      tags: ['Leagues'],
      summary: 'Bulk-import members via CSV rows',
      operationId: 'importMembers',
      body: zodToJsonSchema(ImportLeagueMembersRequestSchema),
      response: {
        201: zodToJsonSchema(LeagueBulkOperationResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requirePermission(membershipRepo, CommissionerPermission.LEAGUE_MEMBERS_INVITE),
    handler: bulk.importMembers,
  });
}
