import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import {
  AddSquadMemberRequestSchema,
  SquadListResponseSchema,
  SquadMembershipResponseSchema,
  SquadResponseSchema,
  UpdateSquadRequestSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { CreateSquadRequestSchema } from '@poolmaster/shared/dto/squads.dto';
import {
  PrismaLeagueMembershipRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadRepository,
} from '../../adapters';
import { createSquadHandlers } from './handler';
import { SquadService } from './service';

export async function squadsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const squadRepo = new PrismaSquadRepository(prisma);
  const squadMembershipRepo = new PrismaSquadMembershipRepository(prisma);
  const leagueMembershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const service = new SquadService(squadRepo, squadMembershipRepo, leagueMembershipRepo, prisma);
  const handler = createSquadHandlers(service);

  fastify.get('/', {
    schema: {
      tags: ['Squads'],
      summary: 'List squads in a league',
      operationId: 'listLeagueSquads',
      response: { 200: zodToJsonSchema(SquadListResponseSchema) },
    },
    handler: handler.listSquads,
  });

  fastify.post('/', {
    schema: {
      tags: ['Squads'],
      summary: 'Create a squad in a league',
      operationId: 'createLeagueSquad',
      body: zodToJsonSchema(CreateSquadRequestSchema),
      response: { 201: zodToJsonSchema(SquadResponseSchema) },
    },
    handler: handler.createSquad,
  });

  fastify.get('/:squadId', {
    schema: {
      tags: ['Squads'],
      summary: 'Get squad details',
      operationId: 'getLeagueSquad',
      response: { 200: zodToJsonSchema(SquadResponseSchema) },
    },
    handler: handler.getSquad,
  });

  fastify.patch('/:squadId', {
    schema: {
      tags: ['Squads'],
      summary: 'Update squad details',
      operationId: 'updateLeagueSquad',
      body: zodToJsonSchema(UpdateSquadRequestSchema),
      response: { 200: zodToJsonSchema(SquadResponseSchema) },
    },
    handler: handler.updateSquad,
  });

  fastify.post('/:squadId/members', {
    schema: {
      tags: ['Squads'],
      summary: 'Add or reactivate a squad co-manager',
      operationId: 'addSquadCoManager',
      body: zodToJsonSchema(AddSquadMemberRequestSchema),
      response: { 201: zodToJsonSchema(SquadMembershipResponseSchema) },
    },
    handler: handler.addCoManager,
  });

  fastify.delete('/:squadId/members/:userId', {
    schema: {
      tags: ['Squads'],
      summary: 'Remove a squad co-manager',
      operationId: 'removeSquadCoManager',
      response: { 200: zodToJsonSchema(SquadMembershipResponseSchema) },
    },
    handler: handler.removeCoManager,
  });
}
