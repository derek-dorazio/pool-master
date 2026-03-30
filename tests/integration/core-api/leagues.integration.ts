/**
 * Integration: League CRUD — create, list, get
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

describe('Leagues Integration', () => {
  let ownerHeaders: Record<string, string>;
  let leagueId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'League Owner' });
    ownerHeaders = owner.headers;
  });

  describe('POST /api/v1/leagues', () => {
    it('creates a league', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/leagues',
        headers: ownerHeaders,
        payload: {
          name: 'Integration Test League',
          visibility: 'PRIVATE',
          maxMembers: 12,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.league.name).toBe('Integration Test League');
      expect(body.league.id).toBeDefined();
      leagueId = body.league.id;
    });

    it('rejects unauthenticated request', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/leagues',
        payload: { name: 'No Auth League' },
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });

  describe('GET /api/v1/leagues', () => {
    it('lists leagues for authenticated user', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/leagues',
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.leagues).toBeDefined();
      expect(Array.isArray(body.leagues)).toBe(true);
      expect(body.leagues.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/v1/leagues/:id', () => {
    it('returns league details', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/leagues/${leagueId}`,
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.league.id).toBe(leagueId);
      expect(body.league.name).toBe('Integration Test League');
    });

    it('returns 403 or 404 for non-existent league', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/leagues/00000000-0000-0000-0000-000000000000',
        headers: ownerHeaders,
      });
      expect([403, 404]).toContain(res.statusCode);
    });
  });
});
