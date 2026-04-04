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
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { ContestType, SelectionType, ScoringEngine, ContestStatus, LeagueVisibility } from '@poolmaster/shared/domain';

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
      url: API_ROUTES.leagues.list,
      headers: ownerHeaders,
      payload: { name: 'Contest Test League', visibility: LeagueVisibility.PRIVATE },
    });
    leagueId = leagueRes.json().league.id;
  });

  describe('POST leagues/:leagueId/contests', () => {
    it('creates a contest', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: API_ROUTES.leagues.contests(leagueId),
        headers: ownerHeaders,
        payload: {
          name: 'Test Golf Pool',
          sport: 'GOLF',
          contestType: ContestType.SINGLE_EVENT,
          selectionType: SelectionType.SNAKE_DRAFT,
          scoringEngine: ScoringEngine.STROKE_PLAY,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      const contest = body.contest ?? body;
      expect(contest.id).toBeDefined();
      expect(contest.name).toBe('Test Golf Pool');
      expect(contest.status).toBe(ContestStatus.DRAFT);
      contestId = contest.id;
    });

    it('creates a contest using a scoring template key', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: API_ROUTES.leagues.contests(leagueId),
        headers: ownerHeaders,
        payload: {
          name: 'Template-backed Golf Pool',
          sport: 'GOLF',
          contestType: ContestType.SINGLE_EVENT,
          selectionType: SelectionType.SNAKE_DRAFT,
          scoringEngine: ScoringEngine.STROKE_PLAY,
          scoringTemplateKey: 'golf_relative_to_par',
        },
      });

      expect(res.statusCode).toBe(201);
      const contest = res.json().contest ?? res.json();
      expect(contest.name).toBe('Template-backed Golf Pool');
      expect(contest.scoringRules).toBeDefined();
      expect(contest.scoringRules.sport).toBe('GOLF');
    });
  });

  describe('GET leagues/:leagueId/contests', () => {
    it('lists contests in the league', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.leagues.contests(leagueId),
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
        url: API_ROUTES.contests.detail(contestId),
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBe(200);
      const contest = res.json().contest ?? res.json();
      expect(contest.id).toBe(contestId);
      expect(contest.name).toBe('Test Golf Pool');
      expect(contest.contestType).toBe(ContestType.SINGLE_EVENT);
      expect(contest.selectionType).toBe(SelectionType.SNAKE_DRAFT);
      expect(contest.scoringEngine).toBe(ScoringEngine.STROKE_PLAY);
    });

    it('returns 403 or 404 for non-existent contest', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.contests.detail('00000000-0000-0000-0000-000000000000'),
        headers: ownerHeaders,
      });
      expect([403, 404]).toContain(res.statusCode);
    });
  });

  describe('contest entry self-service', () => {
    let entryContestId: string;

    beforeAll(async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: API_ROUTES.leagues.contests(leagueId),
        headers: ownerHeaders,
        payload: {
          name: 'Entry Flow Pool',
          contestType: ContestType.SINGLE_EVENT,
          selectionType: SelectionType.SNAKE_DRAFT,
          scoringEngine: ScoringEngine.STROKE_PLAY,
        },
      });
      entryContestId = (res.json().contest ?? res.json()).id;
    });

    it('creates, lists, returns, and deletes the current user entry', async () => {
      const createRes = await getApp().inject({
        method: 'POST',
        url: API_ROUTES.contests.myEntry(entryContestId),
        headers: ownerHeaders,
      });
      expect([200, 201]).toContain(createRes.statusCode);
      expect(createRes.json().entry.name).toContain('Contest Owner');

      const listRes = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.contests.entries(entryContestId),
        headers: ownerHeaders,
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().isJoined).toBe(true);
      expect(listRes.json().total).toBe(1);

      const myEntryRes = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.contests.myEntry(entryContestId),
        headers: ownerHeaders,
      });
      expect(myEntryRes.statusCode).toBe(200);
      expect(myEntryRes.json().entry.ownerDisplayName).toBe('Contest Owner');

      const headersNoContentType = { ...ownerHeaders };
      delete headersNoContentType['content-type'];
      const deleteRes = await getApp().inject({
        method: 'DELETE',
        url: API_ROUTES.contests.myEntry(entryContestId),
        headers: headersNoContentType,
      });
      expect(deleteRes.statusCode).toBe(204);

      const afterDeleteRes = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.contests.myEntry(entryContestId),
        headers: ownerHeaders,
      });
      expect(afterDeleteRes.statusCode).toBe(200);
      expect(afterDeleteRes.json().entry).toBeNull();
    });
  });

  describe('PUT /api/v1/contests/:contestId', () => {
    it('updates the contest name', async () => {
      const res = await getApp().inject({
        method: 'PUT',
        url: API_ROUTES.contests.detail(contestId),
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
        url: API_ROUTES.contests.detail(contestId),
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBe(200);
      const contest = res.json().contest ?? res.json();
      expect(contest.name).toBe('Updated Golf Pool');
    });
  });

  describe('DELETE /api/v1/contests/:contestId', () => {
    it('deletes the contest and its child records', async () => {
      // Don't send content-type: application/json with empty body
      const headersNoContentType = { ...ownerHeaders };
      delete headersNoContentType['content-type'];
      const res = await getApp().inject({
        method: 'DELETE',
        url: API_ROUTES.contests.detail(contestId),
        headers: headersNoContentType,
      });
      expect([200, 204]).toContain(res.statusCode);
    });

    it('contest is gone after deletion', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.contests.detail(contestId),
        headers: ownerHeaders,
      });
      expect([403, 404]).toContain(res.statusCode);
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
