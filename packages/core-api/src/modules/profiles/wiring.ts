/**
 * The tier and pricing profile services (#1844), built once for the app and its test harness.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { PrismaPlatformPricingProfileRepository, PrismaPlatformTierProfileRepository } from '../../adapters';
import {
  PLATFORM_PRICING_PROFILE_KIND,
  ProfileService,
  PLATFORM_TIER_PROFILE_KIND,
  type PlatformPricingProfileService,
  type PlatformTierProfileService,
} from './profile-service';

export function createProfileServices(prisma: PrismaClient, logger?: FastifyBaseLogger): { platformTierProfiles: PlatformTierProfileService; platformPricingProfiles: PlatformPricingProfileService } {
  return {
    platformTierProfiles: new ProfileService({ profiles: new PrismaPlatformTierProfileRepository(prisma), kind: PLATFORM_TIER_PROFILE_KIND, logger }),
    platformPricingProfiles: new ProfileService({ profiles: new PrismaPlatformPricingProfileRepository(prisma), kind: PLATFORM_PRICING_PROFILE_KIND, logger }),
  };
}
