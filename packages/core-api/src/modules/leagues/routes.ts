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
  PrismaActionItemRepository,
} from '../../adapters';
import { requirePermission, requireOwner } from '../../core/require-permission';
import { LeagueService } from './service';
import { InvitationService } from './invitation-service';
import { MemberService } from './member-service';
import { DashboardService } from './dashboard-service';
import { createLeagueHandlers } from './handler';
import { createInvitationHandlers } from './invitation-handler';
import { createMemberHandlers } from './member-handler';
import { createDashboardHandlers } from './dashboard-handler';

export async function leaguesModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const leagueRepo = new PrismaLeagueRepository(prisma);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const invitationRepo = new PrismaLeagueInvitationRepository(prisma);
  const contestRepo = new PrismaContestRepository(prisma);
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

  const league = createLeagueHandlers(leagueService);
  const invitation = createInvitationHandlers(invitationService);
  const member = createMemberHandlers(memberService);
  const dashboard = createDashboardHandlers(dashboardService);

  // --- League CRUD ---

  fastify.get('/', league.listLeagues);

  fastify.post('/', {
    schema: {
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
    },
    handler: league.createLeague,
  });

  fastify.get('/:id', league.getLeague);

  fastify.put('/:id/settings', {
    schema: {
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
    preHandler: requirePermission(membershipRepo, CommissionerPermission.LEAGUE_MEMBERS_INVITE),
    handler: invitation.revokeInviteLink,
  });

  // --- Member Management ---

  fastify.put('/:id/members/:uid/role', {
    schema: {
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
    preHandler: requirePermission(membershipRepo, CommissionerPermission.LEAGUE_MEMBERS_REMOVE),
    handler: member.removeMember,
  });

  fastify.post('/:id/transfer-ownership', {
    schema: {
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

  fastify.get('/:id/dashboard', dashboard.getDashboard);

  fastify.post('/:id/action-items/:itemId/resolve', dashboard.resolveActionItem);
}
