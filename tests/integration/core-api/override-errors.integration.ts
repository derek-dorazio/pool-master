/**
 * Integration: Override service error paths — verifies that invalid override
 * operations return proper error responses (400 / appropriate status codes).
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  cleanupTestData,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { ContestType, SelectionType, ScoringEngine, ContestStatus, LeagueVisibility } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Override Service Error Paths', () => {
  let headers: Record<string, string>;
  let contestId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Override Error Tester' });
    headers = owner.headers;

    // Create a league
    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.list,
      headers,
      payload: { name: 'Override Error Test League', visibility: LeagueVisibility.PRIVATE },
    });
    const leagueId = leagueRes.json().league.id;

    // Create a contest in DRAFT status
    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers,
      payload: {
        name: 'Override Error Pool',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.SNAKE_DRAFT,
        scoringEngine: ScoringEngine.STROKE_PLAY,
      },
    });
    const body = contestRes.json();
    contestId = (body.contest ?? body).id;
  });

  // 1. Undo pick with non-existent pickId — no draft session exists
  describe('POST /contests/:id/draft/undo-pick', () => {
    it('returns 400 when no draft session exists', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/draft/undo-pick`,
        headers,
        payload: {
          pickId: '00000000-0000-0000-0000-000000000000',
          reason: 'testing undo with no session',
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.message).toMatch(/draft session/i);
    });
  });

  // 2. Pause draft when no draft session exists
  describe('POST /contests/:id/draft/pause', () => {
    it('returns 400 when no draft session exists', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/draft/pause`,
        headers,
        payload: { reason: 'testing pause with no session' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.message).toMatch(/draft session/i);
    });
  });

  // 3. Resume draft when not paused (no session at all)
  describe('POST /contests/:id/draft/resume', () => {
    it('returns 400 when no draft session exists', async () => {
      // resume has no body schema, strip content-type
      const { 'content-type': _, ...noContentHeaders } = headers;
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/draft/resume`,
        headers: noContentHeaders,
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.message).toMatch(/draft session/i);
    });
  });

  // 4. Extend pick clock when no draft session exists
  describe('POST /contests/:id/draft/extend-clock', () => {
    it('returns 400 when no draft session exists', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/draft/extend-clock`,
        headers,
        payload: { additionalSeconds: 60 },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.message).toMatch(/draft session/i);
    });
  });

  // 5. Adjust score with non-existent entryId
  describe('POST /contests/:id/scoring/adjust', () => {
    it('returns 400 when entry does not exist', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/scoring/adjust`,
        headers,
        payload: {
          entryId: '00000000-0000-0000-0000-000000000000',
          adjustment: 5,
          reason: 'testing adjust with bogus entry',
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.message).toMatch(/entry not found/i);
    });
  });

  // 6. Confirm payouts on a DRAFT contest (not COMPLETED)
  describe('POST /contests/:id/payouts/confirm', () => {
    it('returns 400 when contest is not completed', async () => {
      // confirmPayouts has no body schema, strip content-type
      const { 'content-type': _, ...noContentHeaders } = headers;
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/payouts/confirm`,
        headers: noContentHeaders,
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.message).toMatch(/completed/i);
    });
  });

  // 7. Reopen a DRAFT contest (only COMPLETED can be reopened)
  describe('POST /contests/:id/reopen', () => {
    it('returns 400 when contest is not completed', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/reopen`,
        headers,
        payload: { reason: 'testing reopen on draft' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.message).toMatch(/completed/i);
    });
  });

  // 8. Close a DRAFT contest — service allows it (only blocks COMPLETED/CANCELLED)
  describe('POST /contests/:id/close', () => {
    it('succeeds when closing a DRAFT contest', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/close`,
        headers,
        payload: { reason: 'force-closing draft contest' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.contest).toBeDefined();
      expect(body.contest.status).toBe(ContestStatus.COMPLETED);
    });
  });
});
