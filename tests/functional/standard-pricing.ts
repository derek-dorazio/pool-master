import type { SlotPricing } from '@poolmaster/shared/domain';
import { listPlatformPricingProfiles } from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { STANDARD_PLATFORM_PRICING_PROFILE_CODE, standardSlotPricing } from '../support/budget-pricing';

/** The Standard pricing profile's values, read through the API, as an Auto-assign prices request sends them. */
export async function standardPricingFor(client: Client): Promise<SlotPricing> {
  const { data } = await listPlatformPricingProfiles({ client });
  // poolmaster-allow-list-lookup: the whole platform list, by its code
  const standard = data?.platformPricingProfiles.find((profile) => profile.code === STANDARD_PLATFORM_PRICING_PROFILE_CODE);
  if (standard === undefined) throw new Error('The Standard pricing profile was not listed.');
  return standardSlotPricing(standard.id);
}
