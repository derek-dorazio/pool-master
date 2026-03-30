/**
 * Integration: Draft session operations and contest entry Prisma operations.
 *
 * Tests hit real Fastify routes backed by in-memory draft store and real Postgres
 * for contest entries.
 */
import { randomUUID } from 'crypto';
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

describe('Draft Sessions & Contest Entries Integration', () => {
  let headers: Record<string, string>;
  let leagueId: string;
  let contestId: string;

  // Mock UUIDs for draft entries and participants
  const entryA = randomUUID();
  const entryB = randomUUID();
  const participantIds = Array.from({ length: 10 }, () => randomUUID());

  beforeAll(async () => {
    // Create user, league, and contest
    const user = await createTestUser({ displayName: 'Draft Tester' });
    headers = user.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers,
      payload: { name: 'Draft Entry Test League', visibility: 'PRIVATE' },
    });
    leagueId = leagueRes.json().league.id;

    const contestRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/contests`,
      headers,
      payload: {
        name: 'Draft Test Contest',
        contestType: 'SINGLE_EVENT',
        selectionType: 'SNAKE_DRAFT',
        scoringEngine: 'STROKE_PLAY',
      },
    });
    const contestBody = contestRes.json();
    contestId = (contestBody.contest ?? contestBody).id;
  });

  // -----------------------------------------------------------------------
  // Draft session routes (in-memory store)
  // -----------------------------------------------------------------------

  describe('POST /api/v1/drafts/:contestId/start', () => {
    it('starts a draft session and returns 201', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/drafts/${contestId}/start`,
        headers,
        payload: {
          entryIds: [entryA, entryB],
          rounds: 3,
          timePerPickSeconds: 120,
          availableParticipantIds: participantIds,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.contestId).toBe(contestId);
      expect(body.status).toBe('LIVE');
      expect(body.rounds).toBe(3);
      expect(body.entryIds).toEqual([entryA, entryB]);
      expect(body.availableParticipants).toHaveLength(participantIds.length);
      expect(body.isComplete).toBe(false);
    });
  });

  describe('GET /api/v1/drafts/:contestId', () => {
    it('returns current draft state with status LIVE', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/drafts/${contestId}`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('LIVE');
      expect(body.currentPickNumber).toBe(1);
      expect(body.currentEntryId).toBe(entryA);
      expect(body.picks).toHaveLength(0);
    });
  });

  describe('POST /api/v1/drafts/:contestId/pick', () => {
    it('submits a valid pick and returns 200', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/drafts/${contestId}/pick`,
        headers,
        payload: {
          entryId: entryA,
          participantId: participantIds[0],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.picks).toHaveLength(1);
      expect(body.picks[0].entryId).toBe(entryA);
      expect(body.picks[0].participantId).toBe(participantIds[0]);
      // After pick 1 in a 2-entry snake draft, it should be entryB's turn
      expect(body.currentEntryId).toBe(entryB);
      expect(body.currentPickNumber).toBe(2);
    });
  });

  describe('GET /api/v1/drafts/:contestId (after pick)', () => {
    it('reflects the recorded pick in the state', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/drafts/${contestId}`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.picks).toHaveLength(1);
      expect(body.picks[0].participantId).toBe(participantIds[0]);
      // The picked participant should no longer be in availableParticipants
      expect(body.availableParticipants).not.toContain(participantIds[0]);
      expect(body.availableParticipants).toHaveLength(participantIds.length - 1);
    });
  });

  describe('POST /api/v1/drafts/:contestId/pick (invalid)', () => {
    it('rejects a pick from the wrong entry with 400', async () => {
      // Currently it is entryB's turn — submitting as entryA should fail
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/drafts/${contestId}/pick`,
        headers,
        payload: {
          entryId: entryA,
          participantId: participantIds[1],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('INVALID_PICK');
      expect(body.message).toContain('Not your turn');
    });
  });

  // -----------------------------------------------------------------------
  // Contest entries via Prisma (real Postgres)
  // -----------------------------------------------------------------------

  describe('Contest entry Prisma operations', () => {
    let leagueMembershipId: string;

    beforeAll(async () => {
      // The league creation auto-creates an OWNER membership for the creating user
      const membership = await getPrisma().leagueMembership.findFirst({
        where: { leagueId },
      });
      expect(membership).not.toBeNull();
      leagueMembershipId = membership!.id;
    });

    it('seeds a contest entry via Prisma', async () => {
      const entry = await getPrisma().contestEntry.create({
        data: {
          contestId,
          leagueMembershipId,
          name: 'Test Entry',
        },
      });

      expect(entry.id).toBeDefined();
      expect(entry.contestId).toBe(contestId);
      expect(entry.leagueMembershipId).toBe(leagueMembershipId);
      expect(entry.name).toBe('Test Entry');
      expect(entry.totalScore).toBe(0);
      expect(entry.isEliminated).toBe(false);
    });

    it('queries entries by contest', async () => {
      const entries = await getPrisma().contestEntry.findMany({
        where: { contestId },
      });

      expect(entries.length).toBeGreaterThanOrEqual(1);
      const testEntry = entries.find((e) => e.name === 'Test Entry');
      expect(testEntry).toBeDefined();
      expect(testEntry!.contestId).toBe(contestId);
    });
  });

  // -----------------------------------------------------------------------
  // Auth enforcement
  // -----------------------------------------------------------------------

  describe('Auth enforcement on draft start', () => {
    it('rejects draft start without authentication', async () => {
      const freshContestId = randomUUID();
      const { 'content-type': _, ...headersNoContentType } = headers;

      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/drafts/${freshContestId}/start`,
        // No auth header, but include content-type for the JSON body
        headers: { 'content-type': 'application/json' },
        payload: {
          entryIds: [randomUUID(), randomUUID()],
          rounds: 3,
          timePerPickSeconds: 120,
          availableParticipantIds: [randomUUID()],
        },
      });

      expect([400, 401]).toContain(res.statusCode);
    });
  });
});
