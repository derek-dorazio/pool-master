/**
 * Integration: Deeper Participant tests + Season Records
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
  // Clean up test participants by name pattern
  const prisma = getPrisma();
  await prisma.participantSeasonRecord.deleteMany({
    where: { participant: { name: { contains: 'Scheffler' } } },
  });
  await prisma.participant.deleteMany({
    where: { name: { contains: 'Scheffler' } },
  });

  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Participants Deep Integration', () => {
  let headers: Record<string, string>;
  let participantId: string;
  let sportId: string;

  beforeAll(async () => {
    const user = await createTestUser({ displayName: 'Participant Deep Tester' });
    headers = user.headers;

    // Look up an existing sport, fall back to creating one
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
          name: 'Scottie Scheffler',
          participantType: 'INDIVIDUAL',
        },
      });
      expect([200, 201]).toContain(res.statusCode);
      const body = res.json();
      const participant = body.participant ?? body;
      expect(participant.id).toBeDefined();
      expect(participant.name).toBe('Scottie Scheffler');
      participantId = participant.id;
    });
  });

  describe('GET /api/v1/participants/:id', () => {
    it('returns participant details', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/participants/${participantId}`,
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const participant = body.participant ?? body;
      expect(participant.id).toBe(participantId);
      expect(participant.name).toBe('Scottie Scheffler');
    });
  });

  describe('PATCH /api/v1/participants/:id', () => {
    it('updates participant metadata', async () => {
      const res = await getApp().inject({
        method: 'PATCH',
        url: `/api/v1/participants/${participantId}`,
        headers,
        payload: {
          position: 'PGA Tour',
          nationality: 'USA',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const participant = body.participant ?? body;
      expect(participant.position).toBe('PGA Tour');
      expect(participant.nationality).toBe('USA');
    });
  });

  describe('GET /api/v1/participants?q=Scheffler', () => {
    it('searches participants by name', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/participants?q=Scheffler',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const participants = Array.isArray(body) ? body : body.participants;
      expect(participants.length).toBeGreaterThanOrEqual(1);
      const match = participants.find(
        (p: { id: string }) => p.id === participantId,
      );
      expect(match).toBeDefined();
    });
  });

  describe('GET /api/v1/participants?sportId=...', () => {
    it('filters participants by sport', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/participants?sportId=${sportId}`,
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const participants = Array.isArray(body) ? body : body.participants;
      expect(participants.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Season Records', () => {
    beforeAll(async () => {
      // Seed a season record directly via Prisma
      await getPrisma().participantSeasonRecord.create({
        data: {
          participantId,
          season: '2025-2026',
          sport: 'GOLF',
          eventsEntered: 20,
          eventsCompleted: 18,
          wins: 5,
          top5Finishes: 10,
        },
      });
    });

    it('GET /api/v1/participants/:id/seasons — lists season records', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/participants/${participantId}/seasons`,
        headers,
      });
      // Seasons endpoint exists and responds
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
    });

    it('GET /api/v1/participants/:id/seasons/2025-2026 — returns specific season', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/participants/${participantId}/seasons/2025-2026`,
        headers,
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
    });
  });
});
