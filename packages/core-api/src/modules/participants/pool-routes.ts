/**
 * Contest pool module — registers pool management routes under /api/v1/contests/:contestId/pool.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import {
  PrismaContestPoolRepository,
  PrismaContestParticipantPoolRepository,
  PrismaParticipantRepository,
  PrismaParticipantSeasonRecordRepository,
} from '../../adapters';
import { ContestPoolService } from './pool-service';
import { createPoolHandlers } from './pool-handler';
import { PricingAndTierService } from './pricing-service';
import { createPricingHandlers } from './pricing-handler';

export async function contestPoolModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const poolRepo = new PrismaContestPoolRepository(prisma);
  const poolParticipantRepo = new PrismaContestParticipantPoolRepository(prisma);
  const participantRepo = new PrismaParticipantRepository(prisma);

  const seasonRecordRepo = new PrismaParticipantSeasonRecordRepository(prisma);

  const poolService = new ContestPoolService(poolRepo, poolParticipantRepo, participantRepo);
  const pricingService = new PricingAndTierService(poolRepo, poolParticipantRepo, seasonRecordRepo);
  const handler = createPoolHandlers(poolService);
  const pricing = createPricingHandlers(pricingService);

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

  // --- Pricing ---

  fastify.post('/pricing/calculate', {
    schema: {
      body: {
        type: 'object',
        required: ['sport', 'totalBudget', 'minPrice', 'maxPrice', 'priceIncrement', 'rankingWeight', 'formWeight', 'oddsWeight'],
        properties: {
          sport: { type: 'string', minLength: 1 },
          totalBudget: { type: 'integer', minimum: 1 },
          minPrice: { type: 'integer', minimum: 0 },
          maxPrice: { type: 'integer', minimum: 1 },
          priceIncrement: { type: 'integer', minimum: 1 },
          rankingWeight: { type: 'number', minimum: 0, maximum: 1 },
          formWeight: { type: 'number', minimum: 0, maximum: 1 },
          oddsWeight: { type: 'number', minimum: 0, maximum: 1 },
          manualOverrides: {
            type: 'array',
            items: {
              type: 'object',
              required: ['participantId', 'overridePrice', 'reason'],
              properties: {
                participantId: { type: 'string' },
                overridePrice: { type: 'integer', minimum: 0 },
                reason: { type: 'string' },
              },
            },
          },
        },
      },
    },
    handler: pricing.calculatePrices,
  });

  fastify.put('/pricing/override/:participantId', {
    schema: {
      body: {
        type: 'object',
        required: ['price', 'reason'],
        properties: {
          price: { type: 'integer', minimum: 0 },
          reason: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: pricing.applyPriceOverride,
  });

  // --- Tier Assignment ---

  fastify.post('/tiers/assign', {
    schema: {
      body: {
        type: 'object',
        required: ['sport', 'assignmentMode', 'tiers'],
        properties: {
          sport: { type: 'string', minLength: 1 },
          assignmentMode: { type: 'string', enum: ['AUTO_RANKING', 'AUTO_PRICE', 'MANUAL'] },
          tiers: {
            type: 'array',
            items: {
              type: 'object',
              required: ['tierId', 'tierName', 'tierNumber', 'picksFromTier'],
              properties: {
                tierId: { type: 'string' },
                tierName: { type: 'string' },
                tierNumber: { type: 'integer', minimum: 1 },
                picksFromTier: { type: 'integer', minimum: 1 },
                rankingRange: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
                priceRange: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
                maxParticipants: { type: 'integer', minimum: 1 },
                participantIds: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    handler: pricing.assignTiers,
  });

  fastify.put('/tiers/:tierId/participants/:participantId', pricing.moveParticipantTier);
}
