/**
 * The root admin's Activity read is rate limited per address: a grid refreshing every few seconds
 * stays inside the limit, a script hammering the read gets 429 ACTIVITY_RATE_LIMITED.
 */
import { ActivityListResponseSchema, ErrorEnvelopeSchema } from '@poolmaster/shared/dto';
import { ACTIVITY_READS_PER_MINUTE } from '../../../packages/core-api/src/modules/activity/routes';
import { createTestUser, getApp, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

describe('Activity read rate limit', () => {
  it('answers every read up to the minute\'s limit, then 429 ACTIVITY_RATE_LIMITED for that address only', async () => {
    const app = getApp();
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    const read = (remoteAddress: string) => app.inject({ method: 'GET', url: '/api/v1/activity/', headers: rootAdmin.headers, remoteAddress });

    for (let index = 0; index < ACTIVITY_READS_PER_MINUTE; index += 1) {
      // A request at a time, as a grid makes them.
      const res = await read('10.0.0.7');
      expect(res.statusCode).toBe(200);
      ActivityListResponseSchema.parse(res.json());
    }

    const over = await read('10.0.0.7');
    expect(over.statusCode).toBe(429);
    expect(ErrorEnvelopeSchema.parse(over.json())).toMatchObject({ error: { code: 'ACTIVITY_RATE_LIMITED' } });

    const otherAddress = await read('10.0.0.8');
    expect(otherAddress.statusCode).toBe(200);
  });
});
