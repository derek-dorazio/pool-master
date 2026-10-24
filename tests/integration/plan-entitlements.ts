import type { PrismaClient } from '@prisma/client';
import { PrismaLeagueRepository } from '../../packages/core-api/src/adapters/prisma-league-repository';
import type { PlanEntitlementsService } from '../../packages/core-api/src/modules/plans/plan-entitlements-service';
import { planEntitlementsOver } from '../support/plan-entitlements';
import { getPrisma } from './helpers';

/** The plan entitlements service over the test database's leagues, on the shipped PLAN_CONFIG. */
export function integrationPlanEntitlements(prisma: PrismaClient = getPrisma()): PlanEntitlementsService {
  return planEntitlementsOver(new PrismaLeagueRepository(prisma));
}
