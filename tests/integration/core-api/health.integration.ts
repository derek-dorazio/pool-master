/**
 * Integration: Health endpoint
 */
import { setupIntegrationTests, teardownIntegrationTests, getApp } from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

describe('GET /health', () => {
  it('returns 200 with ok status', async () => {
    const res = await getApp().inject({ method: 'GET', url: API_ROUTES.health });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'core-api' });
  });
});
