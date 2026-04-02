/**
 * Integration: Contest handler — route-level tests for contest CRUD, lifecycle
 * overrides, scoring recalculation, audit log, and auth enforcement.
 *
 * Hits real Fastify routes backed by real Postgres.
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  getPrisma,
  cleanupTestData,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { ContestType, SelectionType, ScoringEngine, ContestStatus, LeagueVisibility } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Contest Handler Integration', () => {
  let headers: Record<string, string>;
  let leagueId: string;
  let draftContestId: string;   // stays in DRAFT for CRUD tests
  let lifecycleContestId: string; // used for lifecycle transitions

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Handler Owner' });
    headers = owner.headers;

    // Create league
    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.list,
      headers,
      payload: { name: 'Handler Test League', visibility: LeagueVisibility.PRIVATE },
    });
    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;

    // Contest 1 — stays DRAFT
    const c1 = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers,
      payload: {
        name: 'Draft Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.SNAKE_DRAFT,
        scoringEngine: ScoringEngine.STROKE_PLAY,
      },
    });
    expect(c1.statusCode).toBe(201);
    const c1Body = c1.json();
    draftContestId = (c1Body.contest ?? c1Body).id;

    // Contest 2 — used for lifecycle operations
    const c2 = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers,
      payload: {
        name: 'Lifecycle Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.SNAKE_DRAFT,
        scoringEngine: ScoringEngine.STROKE_PLAY,
      },
    });
    expect(c2.statusCode).toBe(201);
    const c2Body = c2.json();
    lifecycleContestId = (c2Body.contest ?? c2Body).id;
  });

  // -----------------------------------------------------------------------
  // 1. GET /api/v1/contests/:id — full response shape
  // -----------------------------------------------------------------------
  describe('GET /api/v1/contests/:id — response shape', () => {
    it('returns the full contest object with expected fields', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.contests.detail(draftContestId),
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const contest = body.contest ?? body;
      expect(contest.id).toBe(draftContestId);
      expect(contest.name).toBe('Draft Contest');
      expect(contest.status).toBe(ContestStatus.DRAFT);
      expect(contest.contestType).toBe(ContestType.SINGLE_EVENT);
      expect(contest.selectionType).toBe(SelectionType.SNAKE_DRAFT);
      expect(contest.scoringEngine).toBe(ScoringEngine.STROKE_PLAY);
      expect(contest.leagueId).toBe(leagueId);
      expect(contest.createdAt).toBeDefined();
      expect(contest.updatedAt).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 2. PUT /api/v1/contests/:id — update name and verify persistence
  // -----------------------------------------------------------------------
  describe('PUT /api/v1/contests/:id — update name', () => {
    it('updates the name and persists the change', async () => {
      const updateRes = await getApp().inject({
        method: 'PUT',
        url: API_ROUTES.contests.detail(draftContestId),
        headers,
        payload: { name: 'Renamed Draft Contest' },
      });
      expect(updateRes.statusCode).toBe(200);
      const updated = updateRes.json().contest ?? updateRes.json();
      expect(updated.name).toBe('Renamed Draft Contest');

      // Verify persistence via GET
      const getRes = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.contests.detail(draftContestId),
        headers,
      });
      expect(getRes.statusCode).toBe(200);
      const fetched = getRes.json().contest ?? getRes.json();
      expect(fetched.name).toBe('Renamed Draft Contest');
    });
  });

  // -----------------------------------------------------------------------
  // 3. PUT /api/v1/contests/:id — update with scoring rules object
  // -----------------------------------------------------------------------
  describe('PUT /api/v1/contests/:id — update scoring rules', () => {
    it('updates scoringRules and returns updated contest', async () => {
      const scoringRules = {
        pointsPerBirdie: 3,
        pointsPerEagle: 5,
        pointsPerBogey: -1,
      };
      const res = await getApp().inject({
        method: 'PUT',
        url: API_ROUTES.contests.detail(draftContestId),
        headers,
        payload: { scoringRules },
      });
      expect(res.statusCode).toBe(200);
      const contest = res.json().contest ?? res.json();
      expect(contest.scoringRules).toBeDefined();
      expect(contest.scoringRules.pointsPerBirdie).toBe(3);
      expect(contest.scoringRules.pointsPerEagle).toBe(5);
      expect(contest.scoringRules.pointsPerBogey).toBe(-1);
    });
  });

  // -----------------------------------------------------------------------
  // 4. PUT /api/v1/contests/:id — update startsAt, endsAt, lockAt simultaneously
  // -----------------------------------------------------------------------
  describe('PUT /api/v1/contests/:id — update dates simultaneously', () => {
    it('updates startsAt, endsAt, and lockAt together', async () => {
      const startsAt = '2026-07-01T10:00:00.000Z';
      const endsAt = '2026-07-04T18:00:00.000Z';
      const lockAt = '2026-07-01T09:00:00.000Z';
      const res = await getApp().inject({
        method: 'PUT',
        url: API_ROUTES.contests.detail(draftContestId),
        headers,
        payload: { startsAt, endsAt, lockAt },
      });
      expect(res.statusCode).toBe(200);
      const contest = res.json().contest ?? res.json();

      // Verify at least the date strings are present (may be ISO-formatted)
      expect(new Date(contest.startsAt).toISOString()).toBe(startsAt);
      expect(new Date(contest.endsAt).toISOString()).toBe(endsAt);
      expect(new Date(contest.lockAt).toISOString()).toBe(lockAt);
    });
  });

  // -----------------------------------------------------------------------
  // 5. DELETE /api/v1/contests/:id — delete in DRAFT status
  // -----------------------------------------------------------------------
  describe('DELETE /api/v1/contests/:id — draft contest', () => {
    let deleteContestId: string;

    beforeAll(async () => {
      // Create a throwaway contest for deletion
      const cr = await getApp().inject({
        method: 'POST',
        url: API_ROUTES.leagues.contests(leagueId),
        headers,
        payload: {
          name: 'Disposable Contest',
          contestType: ContestType.SINGLE_EVENT,
          selectionType: SelectionType.SNAKE_DRAFT,
          scoringEngine: ScoringEngine.STROKE_PLAY,
        },
      });
      deleteContestId = (cr.json().contest ?? cr.json()).id;
    });

    it('deletes a DRAFT contest and returns 204', async () => {
      const { 'content-type': _, ...h } = headers;
      const res = await getApp().inject({
        method: 'DELETE',
        url: API_ROUTES.contests.detail(deleteContestId),
        headers: h,
      });
      expect(res.statusCode).toBe(204);

      // Verify it's gone
      const getRes = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.contests.detail(deleteContestId),
        headers,
      });
      expect(getRes.statusCode).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // 6. POST /api/v1/contests/:id/close — close a contest
  // -----------------------------------------------------------------------
  describe('POST /api/v1/contests/:id/close', () => {
    it('closes the lifecycle contest', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${lifecycleContestId}/close`,
        headers,
        payload: { reason: 'Integration test close' },
      });
      expect(res.statusCode).toBe(200);
      const contest = res.json().contest ?? res.json();
      expect(contest.status).toBe(ContestStatus.COMPLETED);
    });
  });

  // -----------------------------------------------------------------------
  // 7. POST /api/v1/contests/:id/reopen — reopen a closed contest
  // -----------------------------------------------------------------------
  describe('POST /api/v1/contests/:id/reopen', () => {
    it('reopens the closed contest', async () => {
      // Contest should be COMPLETED from test 6
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${lifecycleContestId}/reopen`,
        headers,
        payload: { reason: 'Integration test reopen' },
      });
      expect(res.statusCode).toBe(200);
      const contest = res.json().contest ?? res.json();
      expect(contest.status).toBe(ContestStatus.ACTIVE);
    });

    it('returns 400 when reopening a non-completed contest', async () => {
      // Contest is now ACTIVE (not COMPLETED), so reopen should fail
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${lifecycleContestId}/reopen`,
        headers,
        payload: { reason: 'Should fail' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('BAD_REQUEST');
    });
  });

  // -----------------------------------------------------------------------
  // 8. POST /api/v1/contests/:id/extend-deadline — with future date
  // -----------------------------------------------------------------------
  describe('POST /api/v1/contests/:id/extend-deadline', () => {
    it('extends the deadline with a future date', async () => {
      const newEnd = '2026-08-15T23:59:59.000Z';
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${lifecycleContestId}/extend-deadline`,
        headers,
        payload: { newEnd, reason: 'Need more time' },
      });
      expect(res.statusCode).toBe(200);
      const contest = res.json().contest ?? res.json();
      expect(new Date(contest.endsAt).toISOString()).toBe(newEnd);
    });
  });

  // -----------------------------------------------------------------------
  // 9. POST /api/v1/contests/:id/update-lock — with future date
  // -----------------------------------------------------------------------
  describe('POST /api/v1/contests/:id/update-lock', () => {
    it('updates the lock time with a future date', async () => {
      const newLock = '2026-08-10T12:00:00.000Z';
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${lifecycleContestId}/update-lock`,
        headers,
        payload: { newLock, reason: 'Adjust lock window' },
      });
      expect(res.statusCode).toBe(200);
      const contest = res.json().contest ?? res.json();
      expect(new Date(contest.lockAt).toISOString()).toBe(newLock);
    });
  });

  // -----------------------------------------------------------------------
  // 10. POST /api/v1/contests/:id/scoring/recalculate — no entries
  // -----------------------------------------------------------------------
  describe('POST /api/v1/contests/:id/scoring/recalculate', () => {
    it('returns empty result for contest with no entries', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${lifecycleContestId}/scoring/recalculate`,
        headers,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.contestId).toBe(lifecycleContestId);
      expect(body.teamsAffected).toBe(0);
      expect(body.standingsChanged).toBe(false);
      expect(body.changes).toEqual([]);
    });
  });

  // Note: Contest audit-log route does not exist yet (only league audit-log does)

  // -----------------------------------------------------------------------
  // 12. Auth enforcement — PUT without auth
  // -----------------------------------------------------------------------
  describe('Auth enforcement', () => {
    it('rejects PUT /api/v1/contests/:id without auth', async () => {
      const res = await getApp().inject({
        method: 'PUT',
        url: API_ROUTES.contests.detail(draftContestId),
        payload: { name: 'No Auth Update' },
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error).toBe('UNAUTHORIZED');
    });
  });
});
