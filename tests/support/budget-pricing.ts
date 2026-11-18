import type { EventPricingConfig } from '@poolmaster/shared/domain';

/**
 * The "Standard" pricing profile as an event stores it once priced: $50,000 cap, $100 unit. The
 * migration that made pricing profiles (#1844) creates it from the old settings' defaults.
 */
export function standardEventPricing(): EventPricingConfig {
  return { profileName: 'Standard', salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };
}
