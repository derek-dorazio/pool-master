import type { APIRequestContext } from '@playwright/test';
import { expectOk, type AuthHeaders } from './admin-api';

/**
 * The app's "Standard" pricing profile as an auto-assign request sends it: its values, and its id
 * (#2205), read through the API by the profile's code, since each database gives it its own id.
 */
export async function standardPricingRequest(api: APIRequestContext, headers: AuthHeaders) {
  const response = await expectOk(api.get('/api/v1/pricing-profiles/', { headers }), 'GET /api/v1/pricing-profiles/');
  const { platformPricingProfiles } = (await response.json()) as {
    platformPricingProfiles: Array<{ id: string; code: string; salaryCap: number; unit: number; topSharePercent: number; floorSharePercent: number; steepness: number }>;
  };
  const standard = platformPricingProfiles.find((profile) => profile.code === 'STANDARD');
  if (!standard) throw new Error('The Standard pricing profile is not on this site.');
  const { id, salaryCap, unit, topSharePercent, floorSharePercent, steepness } = standard;
  return { platformPricingProfileId: id, salaryCap, unit, topSharePercent, floorSharePercent, steepness };
}
