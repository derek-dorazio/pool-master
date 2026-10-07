import type { FastifyInstance } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/squads.dto';
import '@poolmaster/shared/dto/team-owner-invitations.dto';
import { SuccessSchema, zodToJsonSchema } from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import {
  PrismaLeagueMembershipRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadOwnerInvitationRepository,
  PrismaSquadRepository,
  PrismaUserRepository,
} from '../../adapters';
import { createSquadHandlers } from './handler';
import { createSquadOwnerInvitationHandlers } from './owner-invitation-handler';
import { SquadOwnerInvitationService } from './owner-invitation-service';
import { SquadService } from './service';
import { getAppPrisma } from '../../core/prisma-context';
import { requireRootAdmin } from '../../core/root-admin-guard';
import {
  leagueFromPath,
  requireCommissioner,
  requireMemberOfLeague,
  requireMemberOfSquad,
} from '../leagues/permissions';

export function squadsModule(fastify: FastifyInstance): void {
  // Routes below $ref named components, so they must be registered on this instance.
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const squadRepo = new PrismaSquadRepository(prisma);
  const squadMembershipRepo = new PrismaSquadMembershipRepository(prisma);
  const squadOwnerInvitationRepo = new PrismaSquadOwnerInvitationRepository(prisma);
  const leagueMembershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const userRepo = new PrismaUserRepository(prisma);
  const service = new SquadService(
    squadRepo,
    squadMembershipRepo,
    leagueMembershipRepo,
    userRepo,
    prisma,
    fastify.log,
  );
  const handler = createSquadHandlers(service);
  const ownerInvitationService = new SquadOwnerInvitationService(
    squadOwnerInvitationRepo,
    leagueMembershipRepo,
    squadRepo,
    squadMembershipRepo,
    userRepo,
    prisma,
  );
  const ownerInvitationHandler = createSquadOwnerInvitationHandlers(ownerInvitationService);

  // #292 — every route here declares its gate (rules/service-rules.md §3 *Route Authorization*).
  // Reading the league's squads needs league membership; acting for a squad needs to own it, or
  // to be its league's commissioner (access rule A7). The services repeat these checks, and still
  // own the ones a hook cannot see, such as which squad an invitation belongs to.
  const leagueMember = { preHandler: requireMemberOfLeague(leagueMembershipRepo, leagueFromPath) };
  const squadMember = {
    preHandler: requireMemberOfSquad(squadRepo, squadMembershipRepo, leagueMembershipRepo),
  };
  const commissioner = { preHandler: requireCommissioner(leagueMembershipRepo) };

  fastify.get('/', {
    ...leagueMember,
    schema: {
      tags: ['Squads'],
      summary: 'List squads in a league',
      description:
        'Returns the squads associated with the current league for team management and contest-entry flows, including requester-scoped teamRelationship plus separate global isRootAdmin flags.',
      operationId: 'listLeagueSquads',
      response: {
        200: schemaRef('SquadListResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.listSquads,
  });

  fastify.post('/', {
    ...leagueMember,
    schema: {
      tags: ['Squads'],
      summary: 'Create a squad in a league',
      description:
        'Creates a squad in the target league for commissioner or member-managed squad participation.',
      operationId: 'createLeagueSquad',
      body: schemaRef('CreateSquadRequest'),
      response: {
        201: schemaRef('SquadResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.createSquad,
  });

  fastify.get('/:squadId', {
    ...leagueMember,
    schema: {
      tags: ['Squads'],
      summary: 'Get squad details',
      description:
        'Returns the detailed squad payload for the requested squad identifier, including requester-scoped teamRelationship plus separate global isRootAdmin flags.',
      operationId: 'getLeagueSquad',
      response: {
        200: schemaRef('SquadResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.getSquad,
  });

  fastify.patch('/:squadId', {
    ...squadMember,
    schema: {
      tags: ['Squads'],
      summary: 'Update squad details',
      description:
        'Updates mutable squad fields such as naming and presentation detail for an active team owner, league commissioner, or root admin.',
      operationId: 'updateLeagueSquad',
      body: schemaRef('UpdateSquadRequest'),
      response: {
        200: schemaRef('SquadResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.updateSquad,
  });

  fastify.post('/:squadId/inactivate', {
    ...commissioner,
    schema: {
      tags: ['Squads'],
      summary: 'Inactivate a team',
      description:
        'Inactivates the target team, preserves its history, and removes its active owners from the league. It does NOT touch their user accounts — they can still sign in, and a commissioner can invite them back, which restores their original team (#218).\n\n**League commissioners and root admins only (#219).** Team owners may invite and remove co-owners on their own team, but ending a team also ends its owners\' league memberships, so it is league administration rather than team management.',
      operationId: 'inactivateLeagueSquad',
      response: {
        200: schemaRef('SquadResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.inactivateSquad,
  });

  fastify.delete('/:squadId', {
    onRequest: requireRootAdmin,
    schema: {
      tags: ['Squads'],
      summary: 'Permanently delete an inactive team',
      description:
        'Permanently deletes an inactive team and cascades related team-owned data. This route is root-admin only and exists to support QA cleanup flows from Team Home.',
      operationId: 'deleteLeagueSquad',
      response: {
        200: zodToJsonSchema(SuccessSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.deleteSquad,
  });

  fastify.post('/:squadId/members', {
    ...squadMember,
    schema: {
      tags: ['Squads'],
      summary: 'Add or reactivate a team owner',
      description:
        'Adds an owner to the team or reactivates an existing inactive owner membership for an active team owner, league commissioner, or root admin.',
      operationId: 'addSquadOwner',
      body: schemaRef('AddSquadMemberRequest'),
      response: {
        201: schemaRef('SquadMembershipResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.addOwner,
  });

  fastify.delete('/:squadId/members/:userId', {
    ...squadMember,
    schema: {
      tags: ['Squads'],
      summary: 'Remove a team owner',
      description:
        'Removes the owner relationship between the target user and team. The backend blocks removal of the final active owner and requires team inactivation instead.',
      operationId: 'removeSquadOwner',
      response: {
        200: schemaRef('SquadMembershipResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.removeOwner,
  });

  fastify.get('/owner-invitations', {
    ...leagueMember,
    schema: {
      tags: ['Squads'],
      summary: 'List team-owner invitations for a league',
      description:
        'Returns pending and historical team-owner invitations visible to the current commissioner, active team owner, or root admin.',
      operationId: 'listSquadOwnerInvitations',
      response: {
        200: schemaRef('TeamOwnerInvitationListResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: ownerInvitationHandler.listOwnerInvitations,
  });

  fastify.post('/:squadId/owner-invitations', {
    ...squadMember,
    schema: {
      tags: ['Squads'],
      summary: 'Invite a co-owner by email',
      description:
        'Starts the co-owner invite flow for a team. Existing PoolMaster users outside the league may be provisioned immediately; current league members are rejected. An inactive league refuses with 400 `LEAGUE_INACTIVE`. Active team owners, league commissioners, and root admins may start this flow.',
      operationId: 'createSquadOwnerInvitation',
      body: schemaRef('CreateSquadOwnerInvitationRequest'),
      response: {
        201: schemaRef('TeamOwnerInvitationResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: ownerInvitationHandler.inviteOwner,
  });

  fastify.post('/:squadId/owners/:userId/replace', {
    ...squadMember,
    schema: {
      tags: ['Squads'],
      summary: 'Replace an active team owner',
      description:
        'Guided replacement flow that removes the selected current owner (ending their team and league membership, as removing an owner does) and starts the same co-owner invite/provisioning flow for the replacement email. Refused when the owner being replaced is the league\'s last active commissioner, and in an inactive league (400 `LEAGUE_INACTIVE`). A team owner may replace a co-owner; a league commissioner or root admin may also replace a team\'s only owner, and the team stays active for the replacement.',
      operationId: 'replaceSquadOwner',
      body: schemaRef('ReplaceSquadOwnerRequest'),
      response: {
        201: schemaRef('TeamOwnerInvitationResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: ownerInvitationHandler.replaceOwner,
  });

  fastify.delete('/owner-invitations/:invitationId', {
    ...leagueMember,
    schema: {
      tags: ['Squads'],
      summary: 'Revoke a pending team-owner invitation',
      description:
        'Revokes a pending co-owner invitation so it can no longer be accepted. Active team owners, league commissioners, and root admins may revoke invitations in their allowed scope.',
      operationId: 'revokeSquadOwnerInvitation',
      response: {
        200: schemaRef('TeamOwnerInvitationResponse'),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: ownerInvitationHandler.revokeOwnerInvitation,
  });
}
