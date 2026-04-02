/**
 * Leagues module — registers all league, invitation, and member management routes.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { CommissionerPermission } from '@poolmaster/shared/domain';
import {
  PrismaLeagueRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueInvitationRepository,
  PrismaContestRepository,
  PrismaContestTemplateRepository,
  PrismaActionItemRepository,
} from '../../adapters';
import { requirePermission, requireOwner } from '../../core/require-permission';
import { LeagueService } from './service';
import { InvitationService } from './invitation-service';
import { MemberService } from './member-service';
import { DashboardService } from './dashboard-service';
import { AuditService } from './audit-service';
import { BulkService } from './bulk-service';
import { createLeagueHandlers } from './handler';
import { createInvitationHandlers } from './invitation-handler';
import { createMemberHandlers } from './member-handler';
import { createDashboardHandlers } from './dashboard-handler';
import { createAuditHandlers } from './audit-handler';
import { createBulkHandlers } from './bulk-handler';
import {
  zodToJsonSchema,
  LeagueResponseSchema,
  LeagueListResponseSchema,
} from '@poolmaster/shared/dto';

export async function leaguesModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const leagueRepo = new PrismaLeagueRepository(prisma);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const invitationRepo = new PrismaLeagueInvitationRepository(prisma);
  const contestRepo = new PrismaContestRepository(prisma);
  const contestTemplateRepo = new PrismaContestTemplateRepository(prisma);
  const actionItemRepo = new PrismaActionItemRepository(prisma);

  const leagueService = new LeagueService(leagueRepo, membershipRepo);
  const invitationService = new InvitationService(invitationRepo, membershipRepo, leagueRepo);
  const memberService = new MemberService(membershipRepo);
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
    contestTemplateRepo,
    leagueRepo,
    membershipRepo,
    invitationRepo,
  );

  const league = createLeagueHandlers(leagueService);
  const invitation = createInvitationHandlers(invitationService);
  const member = createMemberHandlers(memberService);
  const dashboard = createDashboardHandlers(dashboardService);
  const audit = createAuditHandlers(auditService);
  const bulk = createBulkHandlers(bulkService);

  // --- League CRUD ---

  fastify.get('/', {
    schema: {
      tags: ['Leagues'],
      summary: 'List leagues for the current user',
      operationId: 'listLeagues',
      response: { 200: zodToJsonSchema(LeagueListResponseSchema) },
    },
    handler: league.listLeagues,
  });

  fastify.post('/', {
    schema: {
      tags: ['Leagues'],
      summary: 'Create a new league',
      operationId: 'createLeague',
      body: {
        type: 'object',
        required: ['name', 'visibility'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string', maxLength: 500 },
          visibility: { type: 'string', enum: ['PRIVATE', 'PUBLIC'] },
          maxMembers: { type: 'integer', minimum: 2, maximum: 1000 },
          settings: { type: 'object' },
        },
      },
      response: { 201: zodToJsonSchema(LeagueResponseSchema) },
    },
    handler: league.createLeague,
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Leagues'],
      summary: 'Get league details by ID',
      operationId: 'getLeague',
      response: { 200: zodToJsonSchema(LeagueResponseSchema) },
    },
    handler: league.getLeague,
  });

  fastify.put('/:id/settings', {
    schema: {
      tags: ['Leagues'],
      summary: 'Update league settings',
      operationId: 'updateLeagueSettings',
      body: {
        type: 'object',
        properties: {
          invitePolicy: { type: 'string', enum: ['COMMISSIONER_ONLY', 'LINK_INVITE', 'OPEN'] },
          allowMidSeasonJoin: { type: 'boolean' },
          requireApproval: { type: 'boolean' },
          activityFeedEnabled: { type: 'boolean' },
          weeklyRecapEnabled: { type: 'boolean' },
          weeklyRecapDay: {
            type: 'string',
            enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
          },
          timezone: { type: 'string' },
          currency: { type: 'string' },
        },
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
      body: {
        type: 'object',
        required: ['emails'],
        properties: {
          emails: {
            type: 'array',
            items: { type: 'string', format: 'email' },
            minItems: 1,
            maxItems: 50,
          },
          message: { type: 'string', maxLength: 500 },
        },
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
      body: {
        type: 'object',
        properties: {
          expiresInDays: { type: 'integer', minimum: 1, maximum: 90 },
          maxUses: { type: 'integer', minimum: 0 },
        },
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
    },
    preHandler: requirePermission(membershipRepo, CommissionerPermission.LEAGUE_MEMBERS_INVITE),
    handler: invitation.revokeInviteLink,
  });

  // --- Member Management ---

  fastify.put('/:id/members/:uid/role', {
    schema: {
      tags: ['Leagues'],
      summary: 'Change a member role and permissions',
      operationId: 'changeMemberRole',
      body: {
        type: 'object',
        required: ['role'],
        properties: {
          role: { type: 'string', enum: ['COMMISSIONER', 'MANAGER', 'VIEWER'] },
          permissions: { type: 'array', items: { type: 'string' } },
        },
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
    },
    preHandler: requirePermission(membershipRepo, CommissionerPermission.LEAGUE_MEMBERS_REMOVE),
    handler: member.removeMember,
  });

  fastify.post('/:id/transfer-ownership', {
    schema: {
      tags: ['Leagues'],
      summary: 'Transfer league ownership to another member',
      operationId: 'transferOwnership',
      body: {
        type: 'object',
        required: ['newOwnerId'],
        properties: {
          newOwnerId: { type: 'string', minLength: 1 },
        },
      },
    },
    preHandler: requireOwner(membershipRepo),
    handler: member.transferOwnership,
  });

  // --- Commissioner Dashboard ---

  fastify.get('/:id/dashboard', {
    schema: {
      tags: ['Leagues'],
      summary: 'Get commissioner dashboard for a league',
      operationId: 'getLeagueDashboard',
    },
    handler: dashboard.getDashboard,
  });

  fastify.post('/:id/action-items/:itemId/resolve', {
    schema: {
      tags: ['Leagues'],
      summary: 'Resolve a commissioner action item',
      operationId: 'resolveActionItem',
    },
    handler: dashboard.resolveActionItem,
  });

  // --- Audit Log ---

  fastify.get('/:id/audit-log', {
    schema: {
      tags: ['Leagues'],
      summary: 'Get audit log for a league',
      operationId: 'getLeagueAuditLog',
    },
    handler: audit.getLeagueAuditLog,
  });

  fastify.get('/:id/audit-log/member', {
    schema: {
      tags: ['Leagues'],
      summary: 'Get audit log for a specific member',
      operationId: 'getMemberAuditLog',
    },
    handler: audit.getMemberAuditLog,
  });

  // --- Bulk Operations ---

  fastify.post('/:id/contests/bulk', {
    schema: {
      tags: ['Leagues'],
      summary: 'Bulk-create contests from a template',
      operationId: 'bulkCreateContests',
      body: {
        type: 'object',
        required: ['templateId', 'namingPattern', 'events'],
        properties: {
          templateId: { type: 'string' },
          namingPattern: { type: 'string' },
          events: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                startsAt: { type: 'string', format: 'date-time' },
                endsAt: { type: 'string', format: 'date-time' },
              },
            },
            minItems: 1,
          },
        },
      },
    },
    preHandler: requirePermission(membershipRepo, CommissionerPermission.CONTEST_CREATE),
    handler: bulk.bulkCreateContests,
  });

  fastify.post('/:id/contests/copy-season', {
    schema: {
      tags: ['Leagues'],
      summary: 'Copy contests from a previous season',
      operationId: 'copySeason',
      body: {
        type: 'object',
        required: ['sourceContestIds'],
        properties: {
          sourceContestIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          seasonId: { type: 'string' },
        },
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
      body: {
        type: 'object',
        required: ['rows'],
        properties: {
          rows: {
            type: 'array',
            items: {
              type: 'object',
              required: ['email'],
              properties: {
                email: { type: 'string' },
                displayName: { type: 'string' },
                role: { type: 'string' },
              },
            },
            minItems: 1,
            maxItems: 500,
          },
        },
      },
    },
    preHandler: requirePermission(membershipRepo, CommissionerPermission.LEAGUE_MEMBERS_INVITE),
    handler: bulk.importMembers,
  });
}
