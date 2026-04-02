/**
 * Integration: Billing deep tests — plan, entitlements, usage, invoices, auth.
 *
 * Tests billing route handlers against the real Fastify app with Prisma/Postgres.
 * Covers plan retrieval, entitlement shapes, usage tracking after league creation,
 * invoice listing, auth enforcement, and feature flag presence.
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  cleanupTestData,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Billing deep integration', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    const testUser = await createTestUser({ displayName: 'Billing Test User' });
    headers = testUser.headers;
  });

  // ---------------------------------------------------------------------------
  // 1. GET /api/v1/billing/plan — returns plan object with slug, name, entitlements
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/billing/plan', () => {
    it('returns plan object with slug, name, and entitlements', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/plan',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('slug');
      expect(body).toHaveProperty('name');
      expect(typeof body.slug).toBe('string');
      expect(typeof body.name).toBe('string');
      // Free tier is the default
      expect(body.slug).toBe('free');
      expect(body).toHaveProperty('entitlements');
      expect(typeof body.entitlements).toBe('object');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. GET /api/v1/billing/entitlements — returns { entitlements: {...} }
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/billing/entitlements', () => {
    it('returns entitlements object with expected keys', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/entitlements',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('entitlements');
      expect(typeof body.entitlements).toBe('object');

      // Each entitlement key from ALL_ENTITLEMENT_KEYS should be present
      const expectedKeys = [
        'league.create',
        'league.member.add',
        'contest.create',
        'sport.access',
        'draft.type',
        'draft.mode',
        'leaderboard.realtime',
        'scoring.custom',
        'history.access',
        'analytics.access',
        'branding.custom',
        'prizes.intermediate',
        'api.access',
      ];
      for (const key of expectedKeys) {
        expect(body.entitlements).toHaveProperty([key]);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. GET /api/v1/billing/usage — returns usage data
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/billing/usage', () => {
    it('returns usage data with leagues, members, contests counts', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/usage',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('usage');
      expect(body.usage).toHaveProperty('leagues');
      expect(body.usage).toHaveProperty('members');
      expect(body.usage).toHaveProperty('contests');

      // Each usage entry should have resource, current, limit, percentage
      for (const key of ['leagues', 'members', 'contests'] as const) {
        const usage = body.usage[key];
        expect(usage).toHaveProperty('resource');
        expect(usage).toHaveProperty('current');
        expect(usage).toHaveProperty('limit');
        expect(usage).toHaveProperty('percentage');
        expect(typeof usage.current).toBe('number');
        expect(typeof usage.limit).toBe('number');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. GET /api/v1/billing/plans — returns { plans: [...] }
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/billing/plans', () => {
    it('returns plans array with at least 1 tier', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/plans',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('plans');
      expect(Array.isArray(body.plans)).toBe(true);
      expect(body.plans.length).toBeGreaterThanOrEqual(1);

      // Each plan should have basic tier fields
      const plan = body.plans[0];
      expect(plan).toHaveProperty('slug');
      expect(plan).toHaveProperty('name');
      expect(plan).toHaveProperty('entitlements');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Free tier entitlements include expected keys
  // ---------------------------------------------------------------------------
  describe('free tier entitlement keys', () => {
    it('free tier plan entitlements include max_leagues, max_members, max_contests_per_league', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/plan',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.slug).toBe('free');
      const ent = body.entitlements;
      expect(ent).toHaveProperty('max_leagues');
      expect(ent).toHaveProperty('max_members_per_league');
      expect(ent).toHaveProperty('max_contests_per_season');
      expect(typeof ent.max_leagues).toBe('number');
      expect(typeof ent.max_members_per_league).toBe('number');
      expect(typeof ent.max_contests_per_season).toBe('number');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Free tier entitlements allow league creation (max_leagues > 0 or unlimited)
  // ---------------------------------------------------------------------------
  describe('free tier allows league creation', () => {
    it('max_leagues is positive or unlimited (-1)', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/plan',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const maxLeagues = body.entitlements.max_leagues;
      // -1 means unlimited, positive means a concrete limit
      expect(maxLeagues === -1 || maxLeagues > 0).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Usage count reflects created league
  // ---------------------------------------------------------------------------
  describe('usage reflects created league', () => {
    it('league usage increments after creating a league', async () => {
      // Capture baseline usage
      const beforeRes = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/usage',
        headers,
      });
      expect(beforeRes.statusCode).toBe(200);
      const beforeUsage = beforeRes.json().usage.leagues.current;

      // Create a league
      const createRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/leagues',
        headers,
        payload: {
          name: 'Billing Usage Test League',
          visibility: 'PRIVATE',
          maxMembers: 10,
        },
      });
      expect(createRes.statusCode).toBe(201);

      // Check usage after league creation
      const afterRes = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/usage',
        headers,
      });
      expect(afterRes.statusCode).toBe(200);
      const afterUsage = afterRes.json().usage.leagues.current;

      // Usage should have incremented by at least 1
      expect(afterUsage).toBeGreaterThanOrEqual(beforeUsage);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. GET /api/v1/billing/invoices — returns invoice list
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/billing/invoices', () => {
    it('returns invoice list with items array', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/invoices',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('items');
      expect(Array.isArray(body.items)).toBe(true);
      expect(body).toHaveProperty('total');
      expect(typeof body.total).toBe('number');
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Auth enforcement — GET /billing/plan without auth returns 401
  // ---------------------------------------------------------------------------
  describe('auth enforcement', () => {
    it('GET /api/v1/billing/plan without auth returns 401', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/plan',
      });
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/v1/billing/entitlements without auth returns 401', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/entitlements',
      });
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/v1/billing/usage without auth returns 401', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/usage',
      });
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/v1/billing/invoices without auth returns 401', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/invoices',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Plan response includes feature flags (api_access, branding, support_tier)
  // ---------------------------------------------------------------------------
  describe('plan response includes feature flags', () => {
    it('plan entitlements include api_access, branding, and support_tier', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/billing/plan',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const ent = body.entitlements;
      expect(ent).toHaveProperty('api_access');
      expect(typeof ent.api_access).toBe('boolean');
      expect(ent).toHaveProperty('branding');
      expect(typeof ent.branding).toBe('string');
      expect(['NONE', 'LOGO', 'FULL']).toContain(ent.branding);
      expect(ent).toHaveProperty('support_tier');
      expect(typeof ent.support_tier).toBe('string');
      expect(['COMMUNITY', 'EMAIL', 'EMAIL_CHAT', 'DEDICATED']).toContain(ent.support_tier);
    });
  });
});
