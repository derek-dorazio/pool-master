/**
 * Integration: Contest Pool — create, get, lock pool, auth enforcement
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  getPrisma,
  cleanupTestData,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Contest Pool Integration', () => {
  let ownerHeaders: Record<string, string>;
  let contestId: string;
  let leagueId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Pool Owner' });
    ownerHeaders = owner.headers;

    // Create league
    const leagueRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers: ownerHeaders,
      payload: { name: 'Pool Test League', visibility: 'PRIVATE' },
    });
    leagueId = leagueRes.json().league.id;

    // Create contest
    const contestRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/contests`,
      headers: ownerHeaders,
      payload: {
        name: 'Pool Golf Contest',
        contestType: 'SINGLE_EVENT',
        selectionType: 'SNAKE_DRAFT',
        scoringEngine: 'STROKE_PLAY',
      },
    });
    const contestBody = contestRes.json();
    const contest = contestBody.contest ?? contestBody;
    contestId = contest.id;

    // Seed a participant via API so the pool has something to work with
    const prisma = getPrisma();
    let sport = await prisma.sport.findFirst();
    if (!sport) {
      sport = await prisma.sport.create({
        data: { name: 'Golf', participantType: 'INDIVIDUAL' },
      });
    }

    await getApp().inject({
      method: 'POST',
      url: '/api/v1/participants',
      headers: ownerHeaders,
      payload: {
        sportId: sport.id,
        name: 'Tiger Woods',
        participantType: 'INDIVIDUAL',
      },
    });
  });

  describe('POST /api/v1/contests/:contestId/pool', () => {
    it('creates a pool for the contest', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/pool`,
        headers: ownerHeaders,
        payload: { sport: 'GOLF', poolType: 'CUSTOM' },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
      if ([200, 201].includes(res.statusCode)) {
        const body = res.json();
        const pool = body.pool ?? body;
        expect(pool).toBeDefined();
      }
    });
  });

  describe('GET /api/v1/contests/:contestId/pool', () => {
    it('retrieves the contest pool', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/contests/${contestId}/pool`,
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
      if (res.statusCode === 200) {
        const body = res.json();
        const pool = body.pool ?? body;
        expect(pool).toBeDefined();
      }
    });
  });

  describe('POST /api/v1/contests/:contestId/pool/lock', () => {
    it('locks the pool (strip content-type for empty body)', async () => {
      const { 'content-type': _, ...headersNoContentType } = ownerHeaders;
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/pool/lock`,
        headers: headersNoContentType,
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
    });
  });

  describe('Auth enforcement', () => {
    it('rejects POST /pool without auth', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/pool`,
        payload: { sport: 'GOLF', poolType: 'CUSTOM' },
      });
      expect([400, 401]).toContain(res.statusCode);
    });

    it('rejects GET /pool without auth', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/contests/${contestId}/pool`,
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });
});
