/**
 * Integration: Health endpoint
 */
import { setupIntegrationTests, teardownIntegrationTests, getApp } from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

describe('GET /health', () => {
  it('returns 200 with ok status', async () => {
    const res = await getApp().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'core-api' });
  });
});
