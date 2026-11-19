/**
 * The root admin's contests-on-an-event read is rate limited per address (#1889): the Event page's
 * handful of reads stays inside the limit, a script hammering the read gets 429
 * EVENT_ADMIN_RATE_LIMITED.
 */
import { ErrorEnvelopeSchema, SportEventContestListResponseSchema } from '@poolmaster/shared/dto';
import { EVENT_ADMIN_READS_PER_MINUTE } from '../../../packages/core-api/src/modules/events/routes';
import { cleanupTestData, createTestUser, getApp, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { seedEventWithField } from '../list-route-seeds';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Event contests read rate limit', () => {
  it('answers every read up to the minute\'s limit, then 429 EVENT_ADMIN_RATE_LIMITED for that address only', async () => {
    const app = getApp();
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    const { event } = await seedEventWithField(0);
    const read = (remoteAddress: string) => app.inject({ method: 'GET', url: `/api/v1/events/${event.id}/contests`, headers: rootAdmin.headers, remoteAddress });

    for (let index = 0; index < EVENT_ADMIN_READS_PER_MINUTE; index += 1) {
      // A request at a time, as the page makes them.
      const res = await read('10.0.1.7');
      expect(res.statusCode).toBe(200);
      SportEventContestListResponseSchema.parse(res.json());
    }

    const over = await read('10.0.1.7');
    expect(over.statusCode).toBe(429);
    expect(ErrorEnvelopeSchema.parse(over.json())).toMatchObject({ error: { code: 'EVENT_ADMIN_RATE_LIMITED' } });

    const otherAddress = await read('10.0.1.8');
    expect(otherAddress.statusCode).toBe(200);
  });
});
