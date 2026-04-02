/**
 * Contest pool module — registers pool management routes under /api/v1/contests/:contestId/pool.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import {
  zodToJsonSchema,
  ContestPoolResponseSchema,
} from '@poolmaster/shared/dto';
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
import { DraftSearchService } from './draft-search-service';

export async function contestPoolModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const poolRepo = new PrismaContestPoolRepository(prisma);
  const poolParticipantRepo = new PrismaContestParticipantPoolRepository(prisma);
  const participantRepo = new PrismaParticipantRepository(prisma);

  const seasonRecordRepo = new PrismaParticipantSeasonRecordRepository(prisma);

  const poolService = new ContestPoolService(poolRepo, poolParticipantRepo, participantRepo);
  const pricingService = new PricingAndTierService(poolRepo, poolParticipantRepo, seasonRecordRepo);
  const draftSearchService = new DraftSearchService(poolRepo, poolParticipantRepo, participantRepo);
  const handler = createPoolHandlers(poolService);
  const pricing = createPricingHandlers(pricingService);

  // --- Pool CRUD ---

  fastify.post('/', {
    schema: {
      tags: ['Participants'],
      summary: 'Create a contest participant pool',
      operationId: 'createContestPool',
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

  fastify.get('/', {
    schema: {
      tags: ['Participants'],
      summary: 'Get the contest participant pool',
      operationId: 'getContestPool',
      // TODO: add response schema after handler uses DTO mappers
    },
    handler: handler.getPool,
  });

  fastify.put('/', {
    schema: {
      tags: ['Participants'],
      summary: 'Update the contest participant pool',
      operationId: 'updateContestPool',
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

  fastify.post('/resolve', {
    schema: {
      tags: ['Participants'],
      summary: 'Resolve the pool from an external data source',
      operationId: 'resolveContestPool',
    },
    handler: handler.resolvePool,
  });

  fastify.post('/refresh', {
    schema: {
      tags: ['Participants'],
      summary: 'Refresh pool participant data',
      operationId: 'refreshContestPool',
    },
    handler: handler.refreshPool,
  });

  fastify.post('/lock', {
    schema: {
      tags: ['Participants'],
      summary: 'Lock the pool to prevent further changes',
      operationId: 'lockContestPool',
    },
    handler: handler.lockPool,
  });

  // --- Participant management ---

  fastify.delete('/participants/:participantId', {
    schema: {
      tags: ['Participants'],
      summary: 'Exclude a participant from the pool',
      operationId: 'excludePoolParticipant',
    },
    handler: handler.excludeParticipant,
  });

  fastify.post('/participants/:participantId/restore', {
    schema: {
      tags: ['Participants'],
      summary: 'Restore an excluded participant to the pool',
      operationId: 'restorePoolParticipant',
    },
    handler: handler.removeExclusion,
  });

  fastify.post('/participants/:participantId/unavailable', {
    schema: {
      tags: ['Participants'],
      summary: 'Mark a pool participant as unavailable',
      operationId: 'markPoolParticipantUnavailable',
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

  fastify.post('/participants/:participantId/available', {
    schema: {
      tags: ['Participants'],
      summary: 'Mark a pool participant as available',
      operationId: 'markPoolParticipantAvailable',
    },
    handler: handler.markAvailable,
  });

  // --- Pricing ---

  fastify.post('/pricing/calculate', {
    schema: {
      tags: ['Participants'],
      summary: 'Calculate prices for pool participants',
      operationId: 'calculatePoolPricing',
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
      tags: ['Participants'],
      summary: 'Apply a manual price override for a participant',
      operationId: 'applyPoolPriceOverride',
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
      tags: ['Participants'],
      summary: 'Assign participants to tiers',
      operationId: 'assignPoolTiers',
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

  fastify.put('/tiers/:tierId/participants/:participantId', {
    schema: {
      tags: ['Participants'],
      summary: 'Move a participant to a different tier',
      operationId: 'moveParticipantTier',
    },
    handler: pricing.moveParticipantTier,
  });

  // --- Draft Room Search ---

  fastify.get('/search', {
    schema: {
      tags: ['Participants'],
      summary: 'Search pool participants for the draft room',
      operationId: 'searchPoolParticipants',
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          position: { type: 'string' },
          team: { type: 'string' },
          tier: { type: 'string' },
          availableOnly: { type: 'string', enum: ['true', 'false'] },
          undraftedOnly: { type: 'string', enum: ['true', 'false'] },
          draftedIds: { type: 'string' },
          limit: { type: 'string' },
          offset: { type: 'string' },
        },
      },
    },
    handler: async (
      request: FastifyRequest<{
        Params: { contestId: string };
        Querystring: {
          q?: string;
          position?: string;
          team?: string;
          tier?: string;
          availableOnly?: string;
          undraftedOnly?: string;
          draftedIds?: string;
          limit?: string;
          offset?: string;
        };
      }>,
      _reply: FastifyReply,
    ) => {
      const qs = request.query;
      return draftSearchService.search({
        contestId: request.params.contestId,
        query: qs.q,
        position: qs.position ? qs.position.split(',') : undefined,
        team: qs.team ? qs.team.split(',') : undefined,
        tier: qs.tier,
        availableOnly: qs.availableOnly === 'true',
        undraftedOnly: qs.undraftedOnly === 'true',
        draftedParticipantIds: qs.draftedIds ? qs.draftedIds.split(',') : undefined,
        limit: qs.limit ? parseInt(qs.limit, 10) : undefined,
        offset: qs.offset ? parseInt(qs.offset, 10) : undefined,
      });
    },
  });
}
