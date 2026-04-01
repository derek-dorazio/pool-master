/**
 * Pricing and tier route handlers for contest pools.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PricingAndTierService } from './pricing-service';
import {
  PoolNotFoundForPricingError,
  PricingLockedError,
  ParticipantNotInPoolForPricingError,
} from './pricing-service';
import type { PricingConfig, TierConfig, Sport, TierAssignmentMode } from '@poolmaster/shared/domain';

export function createPricingHandlers(pricingService: PricingAndTierService) {
  return {
    calculatePrices,
    applyPriceOverride,
    assignTiers,
    moveParticipantTier,
  };

  async function calculatePrices(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: {
        sport: string;
        totalBudget: number;
        minPrice: number;
        maxPrice: number;
        priceIncrement: number;
        rankingWeight: number;
        formWeight: number;
        oddsWeight: number;
        manualOverrides?: Array<{
          participantId: string;
          overridePrice: number;
          reason: string;
        }>;
      };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const body = request.body;
    const userId = request.headers['x-user-id'] as string;
    const config: PricingConfig = {
      sport: body.sport as Sport,
      contestId: request.params.contestId,
      totalBudget: body.totalBudget,
      minPrice: body.minPrice,
      maxPrice: body.maxPrice,
      priceIncrement: body.priceIncrement,
      rankingWeight: body.rankingWeight,
      formWeight: body.formWeight,
      oddsWeight: body.oddsWeight,
      seedWeight: (body as Record<string, unknown>).seedWeight as number ?? 0,
      manualOverrides: (body.manualOverrides ?? []).map((o) => ({
        ...o,
        setBy: userId ?? 'system',
        setAt: new Date(),
      })),
    };

    try {
      const result = await pricingService.calculateAndApplyPrices(
        request.params.contestId,
        config,
      );
      return reply.send(result);
    } catch (err) {
      return handlePricingError(err, reply);
    }
  }

  async function applyPriceOverride(
    request: FastifyRequest<{
      Params: { contestId: string; participantId: string };
      Body: { price: number; reason: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.headers['x-user-id'] as string;
    try {
      await pricingService.applyPriceOverride(
        request.params.contestId,
        request.params.participantId,
        request.body.price,
        request.body.reason,
        userId ?? 'system',
      );
      return reply.send({ success: true });
    } catch (err) {
      return handlePricingError(err, reply);
    }
  }

  async function assignTiers(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: {
        sport: string;
        assignmentMode: string;
        tiers: Array<{
          tierId: string;
          tierName: string;
          tierNumber: number;
          picksFromTier: number;
          rankingRange?: [number, number];
          priceRange?: [number, number];
          maxParticipants?: number;
          participantIds?: string[];
        }>;
      };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const body = request.body;
    const config: TierConfig = {
      contestId: request.params.contestId,
      sport: body.sport as Sport,
      assignmentMode: body.assignmentMode as TierAssignmentMode,
      tiers: body.tiers.map((t) => ({
        ...t,
        participantIds: t.participantIds ?? [],
      })),
    };

    try {
      const result = await pricingService.assignAndApplyTiers(request.params.contestId, config);
      return reply.send(result);
    } catch (err) {
      return handlePricingError(err, reply);
    }
  }

  async function moveParticipantTier(
    request: FastifyRequest<{
      Params: { contestId: string; tierId: string; participantId: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      await pricingService.moveParticipantTier(
        request.params.contestId,
        request.params.participantId,
        request.params.tierId,
      );
      return reply.send({ success: true });
    } catch (err) {
      return handlePricingError(err, reply);
    }
  }
}

function handlePricingError(err: unknown, reply: FastifyReply): void {
  if (err instanceof PoolNotFoundForPricingError) {
    reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
    return;
  }
  if (err instanceof PricingLockedError) {
    reply.status(409).send({ error: 'POOL_LOCKED', message: err.message });
    return;
  }
  if (err instanceof ParticipantNotInPoolForPricingError) {
    reply.status(404).send({ error: 'PARTICIPANT_NOT_IN_POOL', message: err.message });
    return;
  }
  throw err;
}
