/**
 * Integration: Search & Discovery — participant search, league/contest discovery
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  cleanupTestData,
  getPrisma,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Search & Discovery Integration', () => {
  let headers: Record<string, string>;
  let sportId: string;

  beforeAll(async () => {
    const user = await createTestUser({ displayName: 'Search Tester' });
    headers = user.headers;

    // Ensure a sport exists
    const prisma = getPrisma();
    let sport = await prisma.sport.findFirst();
    if (!sport) {
      sport = await prisma.sport.create({
        data: {
          name: 'Golf',
          participantType: 'INDIVIDUAL',
        },
      });
    }
    sportId = sport.id;

    // Create a searchable participant via the API
    const createRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/participants',
      headers,
      payload: {
        sportId,
        name: 'Tiger Search Test Player',
        participantType: 'INDIVIDUAL',
      },
    });
    expect(createRes.statusCode).toBe(201);
  });

  // -----------------------------------------------------------------------
  // 1. Search participants by name
  // -----------------------------------------------------------------------
  describe('GET /api/v1/search/participants?q=Tiger', () => {
    it('returns matching participants with correct structure', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/search/participants?q=Tiger',
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.participants).toBeDefined();
      expect(Array.isArray(body.participants)).toBe(true);
      expect(body.participants.length).toBeGreaterThanOrEqual(1);
      expect(typeof body.total).toBe('number');
      expect(body.facets).toBeDefined();
      expect(body.facets.positions).toBeDefined();
      expect(body.facets.teams).toBeDefined();
      expect(body.facets.nationalities).toBeDefined();
      expect(body.facets.rankingDistribution).toBeDefined();

      // Verify participant shape
      const p = body.participants[0];
      expect(p.id).toBeDefined();
      expect(p.name).toBeDefined();
      expect(p.sportId).toBeDefined();
      expect(p.participantType).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Search with sport filter
  // -----------------------------------------------------------------------
  describe('GET /api/v1/search/participants?q=&sportId=<id>', () => {
    it('filters participants by sport', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/search/participants?q=&sportId=${sportId}`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.participants)).toBe(true);
      // All returned participants should belong to the filtered sport
      for (const p of body.participants) {
        expect(p.sportId).toBe(sportId);
      }
    });

    it('accepts a sport name and resolves it to the same sport', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/search/participants?q=&sportId=Golf',
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.participants)).toBe(true);
      for (const p of body.participants) {
        expect(p.sportId).toBe(sportId);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 3. Search with pagination
  // -----------------------------------------------------------------------
  describe('GET /api/v1/search/participants?q=&limit=2&offset=0', () => {
    it('respects pagination parameters', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/search/participants?q=&limit=2&offset=0',
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.participants)).toBe(true);
      expect(body.participants.length).toBeLessThanOrEqual(2);
      expect(typeof body.total).toBe('number');
    });
  });

  // -----------------------------------------------------------------------
  // 4. Empty query returns results
  // -----------------------------------------------------------------------
  describe('GET /api/v1/search/participants?q=', () => {
    it('returns results when query is empty', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/search/participants?q=',
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.participants)).toBe(true);
      expect(body.participants.length).toBeGreaterThanOrEqual(1);
      expect(typeof body.total).toBe('number');
    });
  });

  // -----------------------------------------------------------------------
  // 5. Discover leagues
  // -----------------------------------------------------------------------
  describe('GET /api/v1/search/discover/leagues', () => {
    it('returns leagues array with total', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/search/discover/leagues',
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.leagues)).toBe(true);
      expect(typeof body.total).toBe('number');
    });
  });

  // -----------------------------------------------------------------------
  // 6. Discover contests
  // -----------------------------------------------------------------------
  describe('GET /api/v1/search/discover/contests', () => {
    it('returns contests array with total', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/search/discover/contests',
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.contests)).toBe(true);
      expect(typeof body.total).toBe('number');
    });
  });

  // -----------------------------------------------------------------------
  // 7. Auth enforcement
  // -----------------------------------------------------------------------
  describe('Auth enforcement', () => {
    it('rejects search without auth', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/search/participants?q=Tiger',
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects discover/leagues without auth', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/search/discover/leagues',
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects discover/contests without auth', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/search/discover/contests',
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
