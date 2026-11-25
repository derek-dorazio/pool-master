/**
 * The Activity read takes an explicit queue-time window: `from` and `to` bound the jobs it lists,
 * and a window that ends before it starts is refused with 400 ACTIVITY_WINDOW_INVALID.
 */
import { ActivityListResponseSchema, ErrorEnvelopeSchema } from '@poolmaster/shared/dto';
import { createTestUser, getApp, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

describe('Activity read window', () => {
  it('lists the jobs inside an explicit from and to window', async () => {
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    const from = encodeURIComponent('2020-01-01T00:00:00.000Z');
    const to = encodeURIComponent('2020-01-02T00:00:00.000Z');

    const res = await getApp().inject({ method: 'GET', url: `/api/v1/activity/?from=${from}&to=${to}`, headers: rootAdmin.headers, remoteAddress: '10.0.1.1' });

    expect(res.statusCode).toBe(200);
    expect(ActivityListResponseSchema.parse(res.json()).jobs).toEqual([]);
  });

  it('refuses a window whose from is after its to with 400 ACTIVITY_WINDOW_INVALID', async () => {
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    const from = encodeURIComponent('2020-01-02T00:00:00.000Z');
    const to = encodeURIComponent('2020-01-01T00:00:00.000Z');

    const res = await getApp().inject({ method: 'GET', url: `/api/v1/activity/?from=${from}&to=${to}`, headers: rootAdmin.headers, remoteAddress: '10.0.1.2' });

    expect(res.statusCode).toBe(400);
    expect(ErrorEnvelopeSchema.parse(res.json())).toMatchObject({ error: { code: 'ACTIVITY_WINDOW_INVALID' } });
  });
});
