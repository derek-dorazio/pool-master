import type { EventPricingConfig } from '@poolmaster/shared/domain';
import { IN_MEMORY_PLATFORM_PRICING_PROFILE_ID } from './in-memory-sport-events';

/**
 * The "Standard" pricing profile as an event stores it once priced: $50,000 cap, $100 unit, and the
 * profile the values started from (#2205). The migration that made pricing profiles (#1844) creates
 * it from the old settings' defaults. The id defaults to the in-memory store's Standard profile; a
 * test against a database passes the id the database gave it.
 */
export function standardEventPricing(platformPricingProfileId: string | null = IN_MEMORY_PLATFORM_PRICING_PROFILE_ID): EventPricingConfig {
  return { platformPricingProfileId, salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };
}
