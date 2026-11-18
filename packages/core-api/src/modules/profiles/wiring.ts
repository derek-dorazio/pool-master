/**
 * The tier and pricing profile services (#1844), built once for the app and its test harness.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { PrismaPricingProfileRepository, PrismaTierProfileRepository } from '../../adapters';
import {
  PRICING_PROFILE_KIND,
  ProfileService,
  TIER_PROFILE_KIND,
  type PricingProfileService,
  type TierProfileService,
} from './profile-service';

export function createProfileServices(prisma: PrismaClient, logger?: FastifyBaseLogger): { tierProfiles: TierProfileService; pricingProfiles: PricingProfileService } {
  return {
    tierProfiles: new ProfileService({ profiles: new PrismaTierProfileRepository(prisma), kind: TIER_PROFILE_KIND, logger }),
    pricingProfiles: new ProfileService({ profiles: new PrismaPricingProfileRepository(prisma), kind: PRICING_PROFILE_KIND, logger }),
  };
}
