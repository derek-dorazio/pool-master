/**
 * Participants module — registers participant search, CRUD, and season record routes.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import {
  zodToJsonSchema,
  ParticipantListResponseSchema,
} from '@poolmaster/shared/dto';
import {
  PrismaParticipantRepository,
  PrismaParticipantSeasonRecordRepository,
  PrismaParticipantProviderMappingRepository,
} from '../../adapters';
import { ParticipantService } from './service';
import { createParticipantHandlers } from './handler';

export async function participantsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const participantRepo = new PrismaParticipantRepository(prisma);
  const seasonRecordRepo = new PrismaParticipantSeasonRecordRepository(prisma);
  const providerMappingRepo = new PrismaParticipantProviderMappingRepository(prisma);

  const participantService = new ParticipantService(
    participantRepo,
    seasonRecordRepo,
    providerMappingRepo,
  );

  const handler = createParticipantHandlers(participantService);

  // --- Search / List ---

  fastify.get('/', {
    schema: {
      tags: ['Participants'],
      summary: 'Search and list participants',
      operationId: 'searchParticipants',
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          sportId: { type: 'string' },
          status: { type: 'string' },
          position: { type: 'string' },
          team: { type: 'string' },
          nationality: { type: 'string' },
          limit: { type: 'string' },
          offset: { type: 'string' },
        },
      },
      response: { 200: zodToJsonSchema(ParticipantListResponseSchema) },
    },
    handler: handler.searchParticipants,
  });

  // --- CRUD ---

  fastify.get('/:id', {
    schema: {
      tags: ['Participants'],
      summary: 'Get a participant by ID',
      operationId: 'getParticipant',
    },
    handler: handler.getParticipant,
  });

  fastify.post('/', {
    schema: {
      tags: ['Participants'],
      summary: 'Create a new participant',
      operationId: 'createParticipant',
      body: {
        type: 'object',
        required: ['sportId', 'name', 'participantType'],
        properties: {
          sportId: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1, maxLength: 500 },
          participantType: { type: 'string', enum: ['INDIVIDUAL', 'TEAM'] },
          externalId: { type: 'string' },
          firstName: { type: 'string', maxLength: 255 },
          lastName: { type: 'string', maxLength: 255 },
          shortName: { type: 'string', maxLength: 100 },
          nationality: { type: 'string', maxLength: 10 },
          position: { type: 'string', maxLength: 50 },
          teamAffiliation: { type: 'string', maxLength: 255 },
          metadata: { type: 'object' },
          externalIds: { type: 'object' },
        },
      },
    },
    handler: handler.createParticipant,
  });

  fastify.patch('/:id', {
    schema: {
      tags: ['Participants'],
      summary: 'Update a participant',
      operationId: 'updateParticipant',
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 500 },
          firstName: { type: 'string', maxLength: 255 },
          lastName: { type: 'string', maxLength: 255 },
          shortName: { type: 'string', maxLength: 100 },
          nationality: { type: 'string', maxLength: 10 },
          position: { type: 'string', maxLength: 50 },
          teamAffiliation: { type: 'string', maxLength: 255 },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'RETIRED', 'SUSPENDED'] },
          injuryStatus: { type: 'object' },
          photoUrl: { type: 'string' },
          metadata: { type: 'object' },
          externalIds: { type: 'object' },
        },
      },
    },
    handler: handler.updateParticipant,
  });

  // --- Season Records ---

  fastify.get('/:id/seasons', {
    schema: {
      tags: ['Participants'],
      summary: 'Get all season records for a participant',
      operationId: 'getParticipantSeasonRecords',
    },
    handler: handler.getSeasonRecords,
  });

  fastify.get('/:id/seasons/:season', {
    schema: {
      tags: ['Participants'],
      summary: 'Get a specific season record for a participant',
      operationId: 'getParticipantSeasonRecord',
    },
    handler: handler.getSeasonRecord,
  });
}
