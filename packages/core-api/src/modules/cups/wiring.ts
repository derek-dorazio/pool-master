/**
 * The one construction of CupService (#841): contest creation and the cups routes both build it here.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { PrismaCupRepository, PrismaSportLeagueRepository, PrismaSquadRepository } from '../../adapters';
import { createContestService } from '../contests/wiring';
import { CupService } from './service';
import type { PlanEntitlementsService } from '../plans/plan-entitlements-service';

export function createCupService(
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
  planEntitlements: PlanEntitlementsService,
): CupService {
  return new CupService({
    cups: new PrismaCupRepository(prisma),
    liveContests: createContestService(prisma, logger, { planEntitlements }),
    squads: new PrismaSquadRepository(prisma),
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    logger,
  });
}
