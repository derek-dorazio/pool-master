/**
 * Integration: Participant CRUD — create, list, get, update, search
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

describe('Participants Integration', () => {
  let headers: Record<string, string>;
  let participantId: string;
  let sportId: string;

  beforeAll(async () => {
    const user = await createTestUser({ displayName: 'Participant Tester' });
    headers = user.headers;

    // Ensure a sport exists for participant creation
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
  });

  describe('POST /api/v1/participants', () => {
    it('creates a participant', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/participants',
        headers,
        payload: {
          sportId,
          name: 'Tiger Woods',
          participantType: 'INDIVIDUAL',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.participant).toBeDefined();
      expect(body.participant.id).toBeDefined();
      expect(body.participant.name).toBe('Tiger Woods');
      participantId = body.participant.id;
    });

    it('rejects missing required fields', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/participants',
        headers,
        payload: { name: 'Incomplete' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects unauthenticated request', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/participants',
        payload: {
          sportId,
          name: 'No Auth Participant',
          participantType: 'INDIVIDUAL',
        },
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });

  describe('GET /api/v1/participants', () => {
    it('lists participants', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/participants',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.participants).toBeDefined();
      expect(Array.isArray(body.participants)).toBe(true);
      expect(body.participants.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/v1/participants/:id', () => {
    it('returns a participant by ID', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/participants/${participantId}`,
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.participant).toBeDefined();
      expect(body.participant.id).toBe(participantId);
      expect(body.participant.name).toBe('Tiger Woods');
    });

    it('returns 404 for non-existent participant', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/participants/00000000-0000-0000-0000-000000000000',
        headers,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/v1/participants/:id', () => {
    it('updates a participant', async () => {
      const res = await getApp().inject({
        method: 'PATCH',
        url: `/api/v1/participants/${participantId}`,
        headers,
        payload: {
          name: 'Eldrick Tiger Woods',
          position: 'PGA Tour',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.participant).toBeDefined();
      expect(body.participant.name).toBe('Eldrick Tiger Woods');
      expect(body.participant.position).toBe('PGA Tour');
    });

    it('returns 404 when updating non-existent participant', async () => {
      const res = await getApp().inject({
        method: 'PATCH',
        url: '/api/v1/participants/00000000-0000-0000-0000-000000000000',
        headers,
        payload: { name: 'Ghost' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/participants?q=Tiger', () => {
    it('searches participants by query string', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/participants?q=Tiger',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.participants).toBeDefined();
      expect(body.participants.length).toBeGreaterThanOrEqual(1);
      const match = body.participants.find(
        (p: { id: string }) => p.id === participantId,
      );
      expect(match).toBeDefined();
    });
  });

  describe('Auth enforcement', () => {
    it('rejects GET /api/v1/participants without auth', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/participants',
      });
      expect([400, 401]).toContain(res.statusCode);
    });

    it('rejects GET /api/v1/participants/:id without auth', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/participants/${participantId}`,
      });
      expect([400, 401]).toContain(res.statusCode);
    });

    it('rejects PATCH /api/v1/participants/:id without auth', async () => {
      const res = await getApp().inject({
        method: 'PATCH',
        url: `/api/v1/participants/${participantId}`,
        payload: { name: 'Should Fail' },
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });
});
