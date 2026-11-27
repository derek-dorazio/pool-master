import type { SlotPricing } from '@poolmaster/shared/domain';
import type { PrismaClient } from '@prisma/client';
import { IN_MEMORY_PLATFORM_PRICING_PROFILE_ID } from './in-memory-sport-events';

/**
 * The "Standard" pricing profile's values as an event slot stores them once priced (#2044):
 * $50,000 cap, $100 unit, under `platformPricingProfileId`, the Standard profile's id where it is
 * stored. The migration that made pricing profiles (#1844) creates it from the old settings'
 * defaults.
 */
export function standardSlotPricing(platformPricingProfileId: string): SlotPricing {
  return { platformPricingProfileId, salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };
}

/** The Standard pricing profile's code, which its migration gives it. */
export const STANDARD_PLATFORM_PRICING_PROFILE_CODE = 'STANDARD';

/** The Standard pricing profile's values, read from the database, for a test below the API. */
export async function standardPricingIn(prisma: Pick<PrismaClient, 'platformPricingProfile'>): Promise<SlotPricing> {
  const { id } = await prisma.platformPricingProfile.findUniqueOrThrow({ where: { code: STANDARD_PLATFORM_PRICING_PROFILE_CODE }, select: { id: true } });
  return standardSlotPricing(id);
}

/** The in-memory store's Standard pricing profile's values (`IN_MEMORY_PLATFORM_PRICING_PROFILE_ID`), for a unit test. */
export function inMemoryStandardPricing(): SlotPricing {
  return standardSlotPricing(IN_MEMORY_PLATFORM_PRICING_PROFILE_ID);
}

/** Stores these values on an event slot as its set's pricing, below the API, as pricing it would. */
export async function priceTierSetIn(prisma: Pick<PrismaClient, 'sportEventSlot'>, sportEventSlotId: string, pricing: SlotPricing): Promise<void> {
  await prisma.sportEventSlot.update({
    where: { id: sportEventSlotId },
    data: {
      platformPricingProfileId: pricing.platformPricingProfileId,
      salaryCap: pricing.salaryCap,
      pricingUnit: pricing.unit,
      topSharePercent: pricing.topSharePercent,
      floorSharePercent: pricing.floorSharePercent,
      steepness: pricing.steepness,
    },
  });
}
