/**
 * Participants module — registers participant search and CRUD routes.
 */

import type { FastifyInstance } from 'fastify';
import { zodToJsonSchema } from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/participants.dto';
import {
  PrismaParticipantRepository,
  PrismaParticipantProviderMappingRepository,
} from '../../adapters';
import { ParticipantService } from './service';
import { createParticipantHandlers } from './handler';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { getAppPrisma } from '../../core/prisma-context';
import type { ProviderRegistry } from '../ingestion/core/provider-registry';

export interface ParticipantsModuleOptions {
  providerRegistry: ProviderRegistry;
}

export function participantsModule(fastify: FastifyInstance, opts: ParticipantsModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const participantRepo = new PrismaParticipantRepository(prisma);
  const providerMappingRepo = new PrismaParticipantProviderMappingRepository(prisma);

  const participantService = new ParticipantService(
    participantRepo,
    providerMappingRepo,
    fastify.log.child({ module: 'participants.service' }),
  );

  const handler = createParticipantHandlers(participantService, opts.providerRegistry);

  // --- Search / List ---

  fastify.get('/', {
    schema: {
      tags: ['Participants'],
      summary: 'List participants',
      description:
        'The participant catalog, narrowed by text and filters and never paged. Any signed-in user may read it: '
        + 'contest setup and ingestion mapping browse it, and a root admin maintains it.',
      operationId: 'listParticipants',
      querystring: schemaRef('ParticipantListQuery'),
      response: {
        200: schemaRef('ParticipantListResponse'),
      },
    },
    handler: handler.searchParticipants,
  });

  // --- CRUD ---

  fastify.get('/:id', {
    schema: {
      tags: ['Participants'],
      summary: 'Get a participant by ID',
      description:
        'Returns participant detail for the target participant identifier.',
      operationId: 'getParticipant',
      response: {
        200: schemaRef('ParticipantResponse'),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.getParticipant,
  });

  fastify.post('/', {
    onRequest: requireRootAdmin,
    schema: {
      tags: ['Participants'],
      summary: 'Create a participant',
      description:
        'Creates a participant in the shared participant catalog. Root admin only (403 ROOT_ADMIN_ACCESS_REQUIRED otherwise).',
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
          role: { type: 'string', maxLength: 50 },
          teamAffiliation: { type: 'string', maxLength: 255 },
          externalIds: { type: 'object' },
        },
      },
      response: {
        201: schemaRef('ParticipantResponse'),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.createParticipant,
  });

  fastify.patch('/:id', {
    onRequest: requireRootAdmin,
    schema: {
      tags: ['Participants'],
      summary: 'Update a participant',
      description:
        'Updates mutable participant fields such as display metadata and identifiers. Root admin only (403 ROOT_ADMIN_ACCESS_REQUIRED otherwise).',
      operationId: 'updateParticipant',
      response: {
        200: schemaRef('ParticipantResponse'),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
      body: schemaRef('UpdateParticipantRequest'),
    },
    handler: handler.updateParticipant,
  });

  fastify.get('/:id/provider-mappings', {
    schema: {
      tags: ['Participants'],
      summary: 'List a participant\'s provider identities',
      description: 'How each provider knows the participant — the identities synced data is matched by.',
      operationId: 'listParticipantProviderMappings',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        200: schemaRef('ParticipantProviderMappingListResponse'),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.listProviderMappings,
  });

  fastify.post('/:id/provider-mappings', {
    onRequest: requireRootAdmin,
    schema: {
      tags: ['Participants'],
      summary: 'Bind a provider identity to a participant',
      description: 'How a competitor the provider could not match (listUnmappedProviderParticipants) gets their synced data: binds the provider\'s identifier to this participant with MANUAL confidence. An identity already bound to another participant moves here. Root admin only.',
      operationId: 'bindParticipantProviderMapping',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: schemaRef('BindParticipantProviderMappingRequest'),
      response: {
        200: schemaRef('ParticipantProviderMappingResponse'),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handler.bindProviderMapping,
  });
}
