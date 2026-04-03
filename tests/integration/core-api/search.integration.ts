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
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { ContestType, InvitePolicy, LeagueVisibility, ScoringEngine, SelectionType } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Search & Discovery Integration', () => {
  let headers: Record<string, string>;
  let sportId: string;
  let openLeagueId: string;
  let approvalLeagueId: string;
  let discoverableContestId: string;

  beforeAll(async () => {
    const user = await createTestUser({ displayName: 'Search Tester' });
    headers = user.headers;
    const commissioner = await createTestUser({ displayName: 'Discovery Commissioner' });

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

    const openLeagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: commissioner.headers,
      payload: {
        name: 'Open Discovery League',
        visibility: LeagueVisibility.PUBLIC,
        maxMembers: 4,
      },
    });
    expect(openLeagueRes.statusCode).toBe(201);
    openLeagueId = openLeagueRes.json().league.id;

    const approvalLeagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: commissioner.headers,
      payload: {
        name: 'Approval Discovery League',
        visibility: LeagueVisibility.PUBLIC,
        maxMembers: 6,
      },
    });
    expect(approvalLeagueRes.statusCode).toBe(201);
    approvalLeagueId = approvalLeagueRes.json().league.id;

    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(openLeagueId),
      headers: commissioner.headers,
      payload: {
        name: 'Discovery Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.SNAKE_DRAFT,
        scoringEngine: ScoringEngine.STROKE_PLAY,
      },
    });
    expect(contestRes.statusCode).toBe(201);
    discoverableContestId = (contestRes.json().contest ?? contestRes.json()).id;

    const now = new Date();
    await prisma.discoverableLeague.createMany({
      data: [
        {
          id: openLeagueId,
          name: 'Open Discovery League',
          description: 'Joinable from discovery',
          sports: ['GOLF'],
          memberCount: 1,
          maxMembers: 4,
          activeContestCount: 1,
          activityLevel: 'HIGH',
          joinPolicy: InvitePolicy.OPEN,
          lastActivityAt: now,
        },
        {
          id: approvalLeagueId,
          name: 'Approval Discovery League',
          description: 'Requires approval',
          sports: ['GOLF'],
          memberCount: 1,
          maxMembers: 6,
          activeContestCount: 0,
          activityLevel: 'MEDIUM',
          joinPolicy: InvitePolicy.COMMISSIONER_ONLY,
          lastActivityAt: now,
        },
      ],
    });

    await prisma.discoverableContest.create({
      data: {
        id: discoverableContestId,
        leagueId: openLeagueId,
        leagueName: 'Open Discovery League',
        contestName: 'Discovery Contest',
        sport: 'GOLF',
        eventName: 'Spring Championship',
        draftType: 'SNAKE_DRAFT',
        memberCount: 1,
        maxMembers: 4,
        entryFee: 25,
        prizePool: 100,
        draftStart: now,
        lockTime: new Date(now.getTime() + 86_400_000),
        status: 'OPEN',
      },
    });
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
    it('returns leagues array with the enriched discovery shape', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.search.discoverLeagues,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.leagues)).toBe(true);
      expect(typeof body.total).toBe('number');

      const league = body.leagues.find((item: { id: string }) => item.id === openLeagueId);
      expect(league).toMatchObject({
        id: openLeagueId,
        maxMembers: 4,
        activeContestCount: 1,
        activityLevel: 'HIGH',
        joinPolicy: InvitePolicy.OPEN,
        commissionerName: 'Discovery Commissioner',
      });
    });
  });

  // -----------------------------------------------------------------------
  // 6. Discover contests
  // -----------------------------------------------------------------------
  describe('GET /api/v1/search/discover/contests', () => {
    it('returns contests array with the enriched discovery shape', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.search.discoverContests,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.contests)).toBe(true);
      expect(typeof body.total).toBe('number');

      const contest = body.contests.find((item: { id: string }) => item.id === discoverableContestId);
      expect(contest).toMatchObject({
        id: discoverableContestId,
        leagueName: 'Open Discovery League',
        eventName: 'Spring Championship',
        draftType: 'SNAKE_DRAFT',
        maxMembers: 4,
        entryFee: 25,
      });
    });
  });

  describe('POST /api/v1/search/discover/leagues/:leagueId/join', () => {
    it('creates a real membership for open leagues and updates the discovery cache', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: API_ROUTES.search.joinDiscoverableLeague(openLeagueId),
        headers,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.membership).toMatchObject({
        leagueId: openLeagueId,
        role: 'MANAGER',
      });

      const prisma = getPrisma();
      const membership = await prisma.leagueMembership.findUnique({
        where: { leagueId_userId: { leagueId: openLeagueId, userId: body.membership.userId } },
      });
      expect(membership).not.toBeNull();

      const discoverableLeague = await prisma.discoverableLeague.findUnique({
        where: { id: openLeagueId },
      });
      expect(discoverableLeague?.memberCount).toBe(2);
    });

    it('surfaces unsupported approval-request joins instead of pretending success', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: API_ROUTES.search.joinDiscoverableLeague(approvalLeagueId),
        headers,
      });

      expect(res.statusCode).toBe(501);
      expect(res.json()).toMatchObject({
        error: 'JOIN_REQUEST_UNSUPPORTED',
      });
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
        url: API_ROUTES.search.discoverContests,
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects discovery joins without auth', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: API_ROUTES.search.joinDiscoverableLeague(openLeagueId),
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
