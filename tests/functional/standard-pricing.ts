import type { EventPricingConfig } from '@poolmaster/shared/domain';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { listPlatformPricingProfiles } from '@poolmaster/shared/generated/hey-api';
import { standardEventPricing } from '../support/budget-pricing';

/** The Standard profile's values as an auto-assign request sends them, with its id read from the API by its code. */
export async function standardPricingRequest(client: Client): Promise<EventPricingConfig & { platformPricingProfileId: string }> {
  const { data } = await listPlatformPricingProfiles({ client });
  const standard = data?.platformPricingProfiles.find((profile) => profile.code === 'STANDARD');
  if (!standard) throw new Error('The Standard pricing profile is not in the database.');
  return { ...standardEventPricing(standard.id), platformPricingProfileId: standard.id };
}
