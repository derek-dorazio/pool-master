/**
 * Templates module — contest template CRUD at /api/v1/templates.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PrismaContestTemplateRepository } from '../../adapters';
import { ContestTemplateService } from '../contests/template-service';
import { createTemplateHandlers } from '../contests/template-handler';

export async function templatesModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const templateRepo = new PrismaContestTemplateRepository(prisma);
  const templateService = new ContestTemplateService(templateRepo);
  const handlers = createTemplateHandlers(templateService);

  fastify.get('/', {
    schema: {
      tags: ['Templates'],
      summary: 'List contest templates for a league',
      operationId: 'listTemplates',
      querystring: {
        type: 'object',
        required: ['leagueId'],
        properties: {
          leagueId: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: handlers.listTemplates,
  });

  fastify.post('/', {
    schema: {
      tags: ['Templates'],
      summary: 'Create a new contest template',
      operationId: 'createTemplate',
      body: {
        type: 'object',
        required: ['leagueId', 'name', 'sport', 'contestType'],
        properties: {
          leagueId: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string', maxLength: 1000 },
          sport: { type: 'string' },
          contestType: { type: 'string', enum: ['SINGLE_EVENT', 'SEASON_LONG'] },
          draftConfig: { type: 'object' },
          scoringConfig: { type: 'object' },
          payoutConfig: { type: 'object' },
          poolConfig: { type: 'object' },
          sharedWithTenant: { type: 'boolean' },
        },
      },
    },
    handler: handlers.createTemplate,
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Templates'],
      summary: 'Get a contest template by ID',
      operationId: 'getTemplate',
    },
    handler: handlers.getTemplate,
  });

  fastify.put('/:id', {
    schema: {
      tags: ['Templates'],
      summary: 'Update a contest template',
      operationId: 'updateTemplate',
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string', maxLength: 1000 },
          draftConfig: { type: 'object' },
          scoringConfig: { type: 'object' },
          payoutConfig: { type: 'object' },
          poolConfig: { type: 'object' },
          sharedWithTenant: { type: 'boolean' },
        },
      },
    },
    handler: handlers.updateTemplate,
  });

  fastify.delete('/:id', {
    schema: {
      tags: ['Templates'],
      summary: 'Delete a contest template',
      operationId: 'deleteTemplate',
    },
    handler: handlers.deleteTemplate,
  });
}
