/**
 * Contest pool module — registers pool management routes under /api/v1/contests/:contestId/pool.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import {
  PrismaContestPoolRepository,
  PrismaContestParticipantPoolRepository,
  PrismaParticipantRepository,
} from '../../adapters';
import { ContestPoolService } from './pool-service';
import { createPoolHandlers } from './pool-handler';

export async function contestPoolModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const poolRepo = new PrismaContestPoolRepository(prisma);
  const poolParticipantRepo = new PrismaContestParticipantPoolRepository(prisma);
  const participantRepo = new PrismaParticipantRepository(prisma);

  const poolService = new ContestPoolService(poolRepo, poolParticipantRepo, participantRepo);
  const handler = createPoolHandlers(poolService);

  // --- Pool CRUD ---

  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['sport', 'poolType'],
        properties: {
          sport: { type: 'string', minLength: 1 },
          poolType: { type: 'string', enum: ['EVENT_FIELD', 'CUSTOM', 'RANKING_CUTOFF', 'FULL_SPORT'] },
          eventId: { type: 'string' },
          config: { type: 'object' },
        },
      },
    },
    handler: handler.createPool,
  });

  fastify.get('/', handler.getPool);

  fastify.put('/', {
    schema: {
      body: {
        type: 'object',
        properties: {
          poolType: { type: 'string', enum: ['EVENT_FIELD', 'CUSTOM', 'RANKING_CUTOFF', 'FULL_SPORT'] },
          eventId: { type: 'string' },
          config: { type: 'object' },
        },
      },
    },
    handler: handler.updatePool,
  });

  // --- Pool lifecycle ---

  fastify.post('/resolve', handler.resolvePool);

  fastify.post('/refresh', handler.refreshPool);

  fastify.post('/lock', handler.lockPool);

  // --- Participant management ---

  fastify.delete('/participants/:participantId', handler.excludeParticipant);

  fastify.post('/participants/:participantId/restore', handler.removeExclusion);

  fastify.post('/participants/:participantId/unavailable', {
    schema: {
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string', minLength: 1, maxLength: 255 },
        },
      },
    },
    handler: handler.markUnavailable,
  });

  fastify.post('/participants/:participantId/available', handler.markAvailable);
}
