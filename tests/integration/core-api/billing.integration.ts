/**
 * Integration: Billing endpoints
 *
 * Tests billing route handlers against the real Fastify app with Prisma/Postgres.
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

describe('Billing endpoints', () => {
  // -----------------------------------------------------------------------
  // Auth enforcement
  // -----------------------------------------------------------------------
  describe('auth enforcement', () => {
    it('GET /api/v1/billing/plan returns 401 without auth', async () => {
      const res = await getApp().inject({ method: 'GET', url: '/api/v1/billing/plan' });
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/v1/billing/entitlements returns 401 without auth', async () => {
      const res = await getApp().inject({ method: 'GET', url: '/api/v1/billing/entitlements' });
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/v1/billing/usage returns 401 without auth', async () => {
      const res = await getApp().inject({ method: 'GET', url: '/api/v1/billing/usage' });
      expect(res.statusCode).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/billing/plan
  // -----------------------------------------------------------------------
  describe('GET /api/v1/billing/plan', () => {
    it('returns plan details for authenticated tenant', async () => {
      const { headers } = await createTestUser();
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/plan',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Tenant should have a plan slug at minimum
      expect(body).toHaveProperty('slug');
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/billing/entitlements
  // -----------------------------------------------------------------------
  describe('GET /api/v1/billing/entitlements', () => {
    it('returns entitlement map for authenticated tenant', async () => {
      const { headers } = await createTestUser();
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/entitlements',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('entitlements');
      expect(typeof body.entitlements).toBe('object');
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/billing/usage
  // -----------------------------------------------------------------------
  describe('GET /api/v1/billing/usage', () => {
    it('returns usage object with leagues, members, contests', async () => {
      const { headers } = await createTestUser();
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/usage',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.usage).toHaveProperty('leagues');
      expect(body.usage).toHaveProperty('members');
      expect(body.usage).toHaveProperty('contests');
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/billing/plans
  // -----------------------------------------------------------------------
  describe('GET /api/v1/billing/plans', () => {
    it('returns plan tiers list', async () => {
      const { headers: h } = await createTestUser();
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/plans',
        headers: h,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('plans');
      expect(Array.isArray(body.plans)).toBe(true);
      expect(body).toHaveProperty('billingEnabled');
      expect(body).toHaveProperty('upgradeLabel');
    });
  });
});
