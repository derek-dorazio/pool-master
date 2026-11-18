/**
 * The root admin's tier and pricing profile routes are rate limited per address: the admin
 * screens stay inside the limit, a script hammering a route gets 429 PROFILE_RATE_LIMITED.
 */
import { expect } from '@jest/globals';
import { ErrorEnvelopeSchema, PricingProfileListResponseSchema, TierProfileListResponseSchema } from '@poolmaster/shared/dto';
import { PROFILE_REQUESTS_PER_MINUTE } from '../../../packages/core-api/src/modules/profiles/routes';
import { createTestUser, getApp, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

describe('Profile route rate limit', () => {
  it.each([
    ['/api/v1/tier-profiles/', TierProfileListResponseSchema, '10.0.1.7', '10.0.1.8'],
    ['/api/v1/pricing-profiles/', PricingProfileListResponseSchema, '10.0.2.7', '10.0.2.8'],
  ])('answers every read of %s up to the minute\'s limit, then 429 PROFILE_RATE_LIMITED for that address only', async (url, schema, address, otherAddress) => {
    const app = getApp();
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    const read = (remoteAddress: string) => app.inject({ method: 'GET', url, headers: rootAdmin.headers, remoteAddress });

    for (let index = 0; index < PROFILE_REQUESTS_PER_MINUTE; index += 1) {
      // A request at a time, as the admin screens make them.
      const res = await read(address);
      expect(res.statusCode).toBe(200);
      schema.parse(res.json());
    }

    const over = await read(address);
    expect(over.statusCode).toBe(429);
    expect(ErrorEnvelopeSchema.parse(over.json())).toMatchObject({ error: { code: 'PROFILE_RATE_LIMITED' } });

    expect((await read(otherAddress)).statusCode).toBe(200);
  });
});
