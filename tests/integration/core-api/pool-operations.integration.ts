/**
 * Integration: Pool Participant Operations — pricing, tiers, availability, draft search
 *
 * Hits real Fastify routes with real Postgres. Pool routes live under
 * /api/v1/contests/:contestId/pool.
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

describe('Pool Participant Operations', () => {
  let ownerHeaders: Record<string, string>;
  let contestId: string;
  let leagueId: string;
  let participantId: string;
  let poolId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Pool Ops Owner' });
    ownerHeaders = owner.headers;

    // Create league
    const leagueRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers: ownerHeaders,
      payload: { name: 'Pool Ops League', visibility: 'PRIVATE' },
    });
    leagueId = leagueRes.json().league.id;

    // Create contest
    const contestRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/contests`,
      headers: ownerHeaders,
      payload: {
        name: 'Pool Ops Golf Contest',
        contestType: 'SINGLE_EVENT',
        selectionType: 'SNAKE_DRAFT',
        scoringEngine: 'STROKE_PLAY',
      },
    });
    const contestBody = contestRes.json();
    const contest = contestBody.contest ?? contestBody;
    contestId = contest.id;

    // Ensure a sport exists and seed a participant
    const prisma = getPrisma();
    let sport = await prisma.sport.findFirst();
    if (!sport) {
      sport = await prisma.sport.create({
        data: { name: 'Golf', participantType: 'INDIVIDUAL' },
      });
    }

    const partRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/participants',
      headers: ownerHeaders,
      payload: {
        sportId: sport.id,
        name: 'Tiger Woods Pool Ops',
        participantType: 'INDIVIDUAL',
      },
    });
    const partBody = partRes.json();
    participantId = (partBody.participant ?? partBody).id;

    // Create pool
    const poolRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/contests/${contestId}/pool`,
      headers: ownerHeaders,
      payload: { sport: 'GOLF', poolType: 'CUSTOM' },
    });
    const poolBody = poolRes.json();
    poolId = (poolBody.pool ?? poolBody).id;

    // Manually insert the participant into the pool so subsequent operations work
    await prisma.contestParticipantPool.create({
      data: {
        poolId,
        contestId,
        participantId,
        ranking: 1,
        isAvailable: true,
      },
    });
  });

  // ---- 1. Calculate pricing ----

  describe('POST /pool/pricing/calculate', () => {
    it('calculates prices for pool participants', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/pool/pricing/calculate`,
        headers: ownerHeaders,
        payload: {
          sport: 'GOLF',
          totalBudget: 50000,
          minPrice: 1000,
          maxPrice: 10000,
          priceIncrement: 500,
          rankingWeight: 0.5,
          formWeight: 0.3,
          oddsWeight: 0.2,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('updated');
      expect(typeof body.updated).toBe('number');
    });
  });

  // ---- 2. Override price ----

  describe('PUT /pool/pricing/override/:participantId', () => {
    it('overrides price for a pool participant', async () => {
      const res = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/contests/${contestId}/pool/pricing/override/${participantId}`,
        headers: ownerHeaders,
        payload: { price: 7500, reason: 'Manual adjustment' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('success', true);
    });
  });

  // ---- 3. Assign tiers ----

  describe('POST /pool/tiers/assign', () => {
    it('assigns tiers to pool participants', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/pool/tiers/assign`,
        headers: ownerHeaders,
        payload: {
          sport: 'GOLF',
          assignmentMode: 'MANUAL',
          tiers: [
            {
              tierId: 't1',
              tierName: 'Tier 1',
              tierNumber: 1,
              picksFromTier: 2,
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('assigned');
      expect(typeof body.assigned).toBe('number');
    });
  });

  // ---- 4. Mark participant unavailable ----

  describe('POST /pool/participants/:participantId/unavailable', () => {
    it('marks a participant as unavailable', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/pool/participants/${participantId}/unavailable`,
        headers: ownerHeaders,
        payload: { reason: 'Injured' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('participant');
      expect(body.participant.isAvailable).toBe(false);
    });
  });

  // ---- 5. Mark participant available ----

  describe('POST /pool/participants/:participantId/available', () => {
    it('marks a participant as available again', async () => {
      const { 'content-type': _, ...headersNoContentType } = ownerHeaders;
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/pool/participants/${participantId}/available`,
        headers: headersNoContentType,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('participant');
      expect(body.participant.isAvailable).toBe(true);
    });
  });

  // ---- 6. Draft search within pool ----

  describe('GET /pool/search', () => {
    it('searches for participants within the pool', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/contests/${contestId}/pool/search?q=Tiger`,
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('participants');
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('facets');
      expect(Array.isArray(body.participants)).toBe(true);
    });
  });

  // ---- 7. Auth enforcement on pricing ----

  describe('Auth enforcement — pricing', () => {
    it('rejects POST /pool/pricing/calculate without auth', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/pool/pricing/calculate`,
        payload: {
          sport: 'GOLF',
          totalBudget: 50000,
          minPrice: 1000,
          maxPrice: 10000,
          priceIncrement: 500,
          rankingWeight: 0.5,
          formWeight: 0.3,
          oddsWeight: 0.2,
        },
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });

  // ---- 8. Auth enforcement on tier assignment ----

  describe('Auth enforcement — tier assignment', () => {
    it('rejects POST /pool/tiers/assign without auth', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/contests/${contestId}/pool/tiers/assign`,
        payload: {
          sport: 'GOLF',
          assignmentMode: 'MANUAL',
          tiers: [
            {
              tierId: 't1',
              tierName: 'Tier 1',
              tierNumber: 1,
              picksFromTier: 2,
            },
          ],
        },
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });
});
