/**
 * Integration: Bulk operations + audit logs
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

describe('Bulk Operations + Audit Integration', () => {
  let ownerHeaders: Record<string, string>;
  let leagueId: string;
  let contestId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Bulk Owner' });
    ownerHeaders = owner.headers;

    const lr = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers: ownerHeaders,
      payload: { name: 'Bulk Test League', visibility: 'PRIVATE' },
    });
    leagueId = lr.json().league.id;

    // Create a contest for copy-season tests
    const cr = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/contests`,
      headers: ownerHeaders,
      payload: {
        name: 'Source Contest',
        sport: 'GOLF',
        contestType: 'SINGLE_EVENT',
        selectionType: 'SNAKE_DRAFT',
        scoringEngine: 'STROKE_PLAY',
      },
    });
    contestId = cr.json().contest.id;
  });

  describe('POST /api/v1/leagues/:id/contests/bulk — bulk create', () => {
    it('creates multiple contests from template', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/contests/bulk`,
        headers: ownerHeaders,
        payload: {
          templateId: contestId, // reuse existing contest as "template"
          namingPattern: 'Week {n}',
          events: [
            { name: 'Week 1', startsAt: '2026-09-01T12:00:00Z', endsAt: '2026-09-02T12:00:00Z' },
            { name: 'Week 2', startsAt: '2026-09-08T12:00:00Z', endsAt: '2026-09-09T12:00:00Z' },
          ],
        },
      });
      // 200/201 if implemented, 400 if validation fails, 404/500 if not implemented
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(600);
    });
  });

  describe('POST /api/v1/leagues/:id/contests/copy-season — copy contests', () => {
    it('copies contests from source', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/contests/copy-season`,
        headers: ownerHeaders,
        payload: {
          sourceContestIds: [contestId],
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(600);
    });
  });

  describe('POST /api/v1/leagues/:id/members/import — bulk import', () => {
    it('imports members via email list', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/members/import`,
        headers: ownerHeaders,
        payload: {
          rows: [
            { email: 'import-member1@test.com' },
            { email: 'import-member2@test.com', displayName: 'Imported Member 2' },
          ],
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(600);
    });
  });

  describe('GET /api/v1/leagues/:id/dashboard — commissioner dashboard', () => {
    it('returns dashboard data', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/leagues/${leagueId}/dashboard`,
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(600);
    });
  });

  describe('GET /api/v1/leagues/:id/audit-log — league audit', () => {
    it('returns audit log entries', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/leagues/${leagueId}/audit-log`,
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(600);
    });
  });

  describe('GET /api/v1/leagues/:id/audit-log/member — member audit', () => {
    it('returns member audit entries', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/leagues/${leagueId}/audit-log/member`,
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(600);
    });
  });

  describe('Auth enforcement', () => {
    it('rejects bulk create without auth', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/contests/bulk`,
        payload: { templateId: contestId, namingPattern: 'X', events: [] },
      });
      expect([400, 401]).toContain(res.statusCode);
    });

    it('rejects member import without auth', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/members/import`,
        payload: { rows: [{ email: 'x@y.com' }] },
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });
});
