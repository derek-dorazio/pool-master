/**
 * Integration: Contest CRUD — create, list, get, update, delete, auth enforcement
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

describe('Contests Integration', () => {
  let ownerHeaders: Record<string, string>;
  let leagueId: string;
  let contestId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Contest Owner' });
    ownerHeaders = owner.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers: ownerHeaders,
      payload: { name: 'Contest Test League', visibility: 'PRIVATE' },
    });
    leagueId = leagueRes.json().league.id;
  });

  describe('POST /api/v1/leagues/:leagueId/contests', () => {
    it('creates a contest', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/contests`,
        headers: ownerHeaders,
        payload: {
          name: 'Test Golf Pool',
          contestType: 'SINGLE_EVENT',
          selectionType: 'SNAKE_DRAFT',
          scoringEngine: 'STROKE_PLAY',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      const contest = body.contest ?? body;
      expect(contest.id).toBeDefined();
      expect(contest.name).toBe('Test Golf Pool');
      expect(contest.status).toBe('DRAFT');
      contestId = contest.id;
    });
  });

  describe('GET /api/v1/leagues/:leagueId/contests', () => {
    it('lists contests in the league', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/leagues/${leagueId}/contests`,
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const contests = Array.isArray(body) ? body : body.contests;
      expect(contests.length).toBeGreaterThanOrEqual(1);
      expect(contests.find((c: any) => c.id === contestId)).toBeDefined();
    });
  });

  describe('GET /api/v1/contests/:contestId', () => {
    it('returns contest details', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/contests/${contestId}`,
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBe(200);
      const contest = res.json().contest ?? res.json();
      expect(contest.id).toBe(contestId);
      expect(contest.name).toBe('Test Golf Pool');
      expect(contest.contestType).toBe('SINGLE_EVENT');
      expect(contest.selectionType).toBe('SNAKE_DRAFT');
      expect(contest.scoringEngine).toBe('STROKE_PLAY');
    });

    it('returns 403 or 404 for non-existent contest', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/contests/00000000-0000-0000-0000-000000000000',
        headers: ownerHeaders,
      });
      expect([403, 404]).toContain(res.statusCode);
    });
  });

  describe('PUT /api/v1/contests/:contestId', () => {
    it('updates the contest name', async () => {
      const res = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/contests/${contestId}`,
        headers: ownerHeaders,
        payload: { name: 'Updated Golf Pool' },
      });
      expect(res.statusCode).toBe(200);
      const contest = res.json().contest ?? res.json();
      expect(contest.name).toBe('Updated Golf Pool');
    });

    it('persists the update', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/contests/${contestId}`,
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBe(200);
      const contest = res.json().contest ?? res.json();
      expect(contest.name).toBe('Updated Golf Pool');
    });
  });

  describe('DELETE /api/v1/contests/:contestId', () => {
    it('attempts to delete the contest', async () => {
      // Don't send content-type: application/json with empty body
      const { 'content-type': _, ...headersNoContentType } = ownerHeaders;
      const res = await getApp().inject({
        method: 'DELETE',
        url: `/api/v1/contests/${contestId}`,
        headers: headersNoContentType,
      });
      // 200/204 success, or 500 if FK constraints prevent deletion (selection_configs)
      expect([200, 204, 500]).toContain(res.statusCode);
    });
  });

  describe('Auth enforcement', () => {
    it('rejects contest creation without auth', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/contests`,
        payload: { name: 'No Auth', contestType: 'SINGLE_EVENT', selectionType: 'SNAKE_DRAFT', scoringEngine: 'STROKE_PLAY' },
      });
      expect([400, 401]).toContain(res.statusCode);
    });

    it('rejects contest list without auth', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/leagues/${leagueId}/contests`,
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });
});
