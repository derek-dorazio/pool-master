import type { FastifyInstance } from 'fastify';
import {
  CreateSquadOwnerInvitationRequestSchema,
  AddSquadMemberRequestSchema,
  ReplaceSquadOwnerRequestSchema,
  SquadListResponseSchema,
  SquadMembershipResponseSchema,
  SquadResponseSchema,
  TeamOwnerInvitationListResponseSchema,
  TeamOwnerInvitationResponseSchema,
  UpdateSquadRequestSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { CreateSquadRequestSchema } from '@poolmaster/shared/dto/squads.dto';
import {
  PrismaLeagueMembershipRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadOwnerInvitationRepository,
  PrismaSquadRepository,
} from '../../adapters';
import { createSquadHandlers } from './handler';
import { createSquadOwnerInvitationHandlers } from './owner-invitation-handler';
import { SquadOwnerInvitationService } from './owner-invitation-service';
import { SquadService } from './service';
import { getAppPrisma } from '../../core/prisma-context';

export async function squadsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = getAppPrisma(fastify);
  const squadRepo = new PrismaSquadRepository(prisma);
  const squadMembershipRepo = new PrismaSquadMembershipRepository(prisma);
  const squadOwnerInvitationRepo = new PrismaSquadOwnerInvitationRepository(prisma);
  const leagueMembershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const service = new SquadService(squadRepo, squadMembershipRepo, leagueMembershipRepo, prisma);
  const handler = createSquadHandlers(service);
  const ownerInvitationService = new SquadOwnerInvitationService(
    squadOwnerInvitationRepo,
    leagueMembershipRepo,
    squadRepo,
    squadMembershipRepo,
    prisma,
  );
  const ownerInvitationHandler = createSquadOwnerInvitationHandlers(ownerInvitationService);

  fastify.get('/', {
    schema: {
      tags: ['Squads'],
      summary: 'List squads in a league',
      description:
        'Returns the squads associated with the current league for squad management and contest-entry flows.',
      operationId: 'listLeagueSquads',
      response: {
        200: zodToJsonSchema(SquadListResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.listSquads,
  });

  fastify.post('/', {
    schema: {
      tags: ['Squads'],
      summary: 'Create a squad in a league',
      description:
        'Creates a squad in the target league for commissioner or member-managed squad participation.',
      operationId: 'createLeagueSquad',
      body: zodToJsonSchema(CreateSquadRequestSchema),
      response: {
        201: zodToJsonSchema(SquadResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.createSquad,
  });

  fastify.get('/:squadId', {
    schema: {
      tags: ['Squads'],
      summary: 'Get squad details',
      description:
        'Returns the detailed squad payload for the requested squad identifier.',
      operationId: 'getLeagueSquad',
      response: {
        200: zodToJsonSchema(SquadResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.getSquad,
  });

  fastify.patch('/:squadId', {
    schema: {
      tags: ['Squads'],
      summary: 'Update squad details',
      description:
        'Updates mutable squad fields such as naming and presentation detail.',
      operationId: 'updateLeagueSquad',
      body: zodToJsonSchema(UpdateSquadRequestSchema),
      response: {
        200: zodToJsonSchema(SquadResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.updateSquad,
  });

  fastify.post('/:squadId/members', {
    schema: {
      tags: ['Squads'],
      summary: 'Add or reactivate a team owner',
      description:
        'Adds an owner to the team or reactivates an existing inactive owner membership.',
      operationId: 'addSquadOwner',
      body: zodToJsonSchema(AddSquadMemberRequestSchema),
      response: {
        201: zodToJsonSchema(SquadMembershipResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.addOwner,
  });

  fastify.delete('/:squadId/members/:userId', {
    schema: {
      tags: ['Squads'],
      summary: 'Remove a team owner',
      description:
        'Removes the owner relationship between the target user and team.',
      operationId: 'removeSquadOwner',
      response: {
        200: zodToJsonSchema(SquadMembershipResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.removeOwner,
  });

  fastify.get('/owner-invitations', {
    schema: {
      tags: ['Squads'],
      summary: 'List team-owner invitations for a league',
      description:
        'Returns pending and historical team-owner invitations visible to the current commissioner or team owner.',
      operationId: 'listSquadOwnerInvitations',
      response: {
        200: zodToJsonSchema(TeamOwnerInvitationListResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: ownerInvitationHandler.listOwnerInvitations,
  });

  fastify.post('/:squadId/owner-invitations', {
    schema: {
      tags: ['Squads'],
      summary: 'Invite a co-owner by email',
      description:
        'Starts the co-owner invite flow for a team. Existing PoolMaster users outside the league may be provisioned immediately; current league members are rejected.',
      operationId: 'createSquadOwnerInvitation',
      body: zodToJsonSchema(CreateSquadOwnerInvitationRequestSchema),
      response: {
        201: zodToJsonSchema(TeamOwnerInvitationResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: ownerInvitationHandler.inviteOwner,
  });

  fastify.post('/:squadId/owners/:userId/replace', {
    schema: {
      tags: ['Squads'],
      summary: 'Replace an active team owner',
      description:
        'Guided replacement flow that inactivates the selected current owner and starts the same co-owner invite/provisioning flow for the replacement email.',
      operationId: 'replaceSquadOwner',
      body: zodToJsonSchema(ReplaceSquadOwnerRequestSchema),
      response: {
        201: zodToJsonSchema(TeamOwnerInvitationResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: ownerInvitationHandler.replaceOwner,
  });

  fastify.delete('/owner-invitations/:invitationId', {
    schema: {
      tags: ['Squads'],
      summary: 'Revoke a pending team-owner invitation',
      description:
        'Revokes a pending co-owner invitation so it can no longer be accepted.',
      operationId: 'revokeSquadOwnerInvitation',
      response: {
        200: zodToJsonSchema(TeamOwnerInvitationResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: ownerInvitationHandler.revokeOwnerInvitation,
  });
}
