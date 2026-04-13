/**
 * Leagues module — registers all league, invitation, and member management routes.
 */

import type { FastifyInstance } from 'fastify';
import { CommissionerPermission } from '@poolmaster/shared/domain';
import {
  CreateLeagueRequestSchema,
  DeleteLeagueRequestSchema,
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

  const leagueService = new LeagueService(leagueRepo, membershipRepo, prisma);
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
      description:
        'Returns the league summaries visible to the authenticated user. This list powers the welcome page, header selector, and richer My Leagues overview.',
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
      description:
        'Creates a new private league for the authenticated commissioner using the submitted unique `leagueCode`, then returns the initial league detail payload.',
      operationId: 'createLeague',
      body: zodToJsonSchema(CreateLeagueRequestSchema),
      response: {
        201: zodToJsonSchema(LeagueResponseSchema),
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
        'Returns detailed league information by internal league ID for authenticated member or commissioner surfaces that already know the database identifier.',
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
      description:
        'Returns detailed league information by stable league code. This is the preferred route for bookmarkable `/league/<leagueCode>` web navigation.',
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
      description:
        'Allows a commissioner to patch league settings such as activity state and invitation policy. The resulting league payload should drive read-only or active UI behavior.',
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

  fastify.post('/:id/inactivate', {
    schema: {
      tags: ['Leagues'],
      summary: 'Inactivate a league',
      description:
        'Allows a commissioner to mark a league inactive. Inactive leagues remain visible, but this action is the required first step before a permanent delete becomes available.',
      operationId: 'inactivateLeague',
      response: {
        200: zodToJsonSchema(LeagueResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requirePermission(membershipRepo, CommissionerPermission.LEAGUE_SETTINGS_EDIT),
    handler: league.inactivateLeague,
  });

  fastify.delete('/:id', {
    schema: {
      tags: ['Leagues'],
      summary: 'Delete an inactive league permanently',
      description:
        'Allows a commissioner to permanently delete an inactive league after typing the exact `leagueCode` confirmation. This removes league-owned data and relationships while preserving user accounts.',
      operationId: 'deleteLeague',
      body: zodToJsonSchema(DeleteLeagueRequestSchema),
      response: {
        200: zodToJsonSchema(SuccessSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requirePermission(membershipRepo, CommissionerPermission.LEAGUE_SETTINGS_EDIT),
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
      description:
        'Creates a reusable invitation link for the target league. The resulting invite code is later previewed through the public invitation endpoints.',
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
      description:
        'Revokes a previously created shareable invite link so the invite code can no longer be accepted by future users.',
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
      description:
        'Returns the current league membership list for authenticated members and commissioners. This powers member rosters and commissioner management surfaces.',
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
      description:
        'Allows a commissioner to promote or demote a member and optionally adjust explicit permission overrides for that membership.',
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
    preHandler: requirePermission(membershipRepo, CommissionerPermission.LEAGUE_MEMBERS_REMOVE),
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
      description:
        'Marks a commissioner action item as resolved and returns the updated action-item record for the league dashboard.',
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
      description:
        'Returns the commissioner-visible audit log for league-level actions.',
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
      description:
        'Returns member-scoped audit information inside the league for commissioner or permitted member review surfaces.',
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
      description:
        'Copies prior contest definitions into the current league so commissioners can bootstrap a new season from historical contests.',
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
      description:
        'Imports member rows for the league and creates invitations or memberships according to the validated bulk payload.',
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
