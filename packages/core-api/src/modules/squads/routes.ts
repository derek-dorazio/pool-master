import type { FastifyInstance } from 'fastify';
import {
  AddSquadMemberRequestSchema,
  SquadListResponseSchema,
  SquadMembershipResponseSchema,
  SquadResponseSchema,
  UpdateSquadRequestSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { CreateSquadRequestSchema } from '@poolmaster/shared/dto/squads.dto';
import {
  PrismaLeagueMembershipRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadRepository,
} from '../../adapters';
import { createSquadHandlers } from './handler';
import { SquadService } from './service';
import { getAppPrisma } from '../../core/prisma-context';

export async function squadsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = getAppPrisma(fastify);
  const squadRepo = new PrismaSquadRepository(prisma);
  const squadMembershipRepo = new PrismaSquadMembershipRepository(prisma);
  const leagueMembershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const service = new SquadService(squadRepo, squadMembershipRepo, leagueMembershipRepo, prisma);
  const handler = createSquadHandlers(service);

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
      summary: 'Add or reactivate a squad co-manager',
      description:
        'Adds a co-manager to the squad or reactivates an existing inactive co-manager membership.',
      operationId: 'addSquadCoManager',
      body: zodToJsonSchema(AddSquadMemberRequestSchema),
      response: {
        201: zodToJsonSchema(SquadMembershipResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.addCoManager,
  });

  fastify.delete('/:squadId/members/:userId', {
    schema: {
      tags: ['Squads'],
      summary: 'Remove a squad co-manager',
      description:
        'Removes the co-manager relationship between the target user and squad.',
      operationId: 'removeSquadCoManager',
      response: {
        200: zodToJsonSchema(SquadMembershipResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.removeCoManager,
  });
}
