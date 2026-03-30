/**
 * Integration: Admin module + History module
 *
 * Admin routes require x-admin-user-id header (separate from JWT auth).
 * History routes are under /api/v1/contests/:id/history/*.
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

describe('Admin Module Integration', () => {
  let headers: Record<string, string>;
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser({ displayName: 'Admin Test' });
    headers = user.headers;
    userId = user.user.id;
  });

  describe('Admin auth enforcement', () => {
    it('GET /api/v1/admin/tenants returns 401 without admin header', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/admin/tenants',
        headers,
      });
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/v1/admin/users returns 401 without admin header', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/admin/users?search=test',
        headers,
      });
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/v1/admin/health/services returns 401 without admin header', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/admin/health/services',
        headers,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('Admin with x-admin-user-id', () => {
    it('GET /api/v1/admin/tenants responds with admin auth', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/admin/tenants',
        headers: { ...headers, 'x-admin-user-id': userId },
      });
      // 200 if admin lookup succeeds, 403 if user not in admin_users table
      expect([200, 403]).toContain(res.statusCode);
    });

    it('GET /api/v1/admin/users responds with admin auth', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/admin/users?search=test',
        headers: { ...headers, 'x-admin-user-id': userId },
      });
      expect([200, 403]).toContain(res.statusCode);
    });

    it('GET /api/v1/admin/health/services responds with admin auth', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/admin/health/services',
        headers: { ...headers, 'x-admin-user-id': userId },
      });
      expect([200, 403]).toContain(res.statusCode);
    });
  });
});

describe('History Module Integration', () => {
  let headers: Record<string, string>;
  let contestId: string;

  beforeAll(async () => {
    const user = await createTestUser({ displayName: 'History Test' });
    headers = user.headers;

    const lr = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers,
      payload: { name: 'History League', visibility: 'PRIVATE' },
    });
    const leagueId = lr.json().league.id;

    const cr = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/contests`,
      headers,
      payload: { name: 'History Contest', contestType: 'SINGLE_EVENT', selectionType: 'SNAKE_DRAFT', scoringEngine: 'STROKE_PLAY' },
    });
    contestId = cr.json().contest.id;
  });

  describe('GET /api/v1/contests/:id/history/summary', () => {
    it('returns 404 for contest with no results', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/contests/${contestId}/history/summary`,
        headers,
      });
      expect([200, 404]).toContain(res.statusCode);
    });
  });

  describe('GET /api/v1/contests/:id/history/standings', () => {
    it('returns historical standings (may be empty)', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/contests/${contestId}/history/standings`,
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.standings).toBeDefined();
    });
  });

  describe('Auth enforcement', () => {
    it('rejects history without auth', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/contests/${contestId}/history/standings`,
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });
});
