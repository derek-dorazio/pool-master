import { randomUUID } from 'crypto';
import { Sport } from '@poolmaster/shared/domain';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import { freshEventEdition } from '../../support/event-edition';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('events routes', () => {
  it('filters events by sport and status and returns contest-eligible readiness for loaded fields', async () => {
    const prisma = getPrisma();
    const viewer = await createTestUser({ displayName: 'Events Route Viewer' });
    const eligibleEventId = randomUUID();
    const filteredOutEventId = randomUUID();
    const participantId = randomUUID();

    await prisma.sport.upsert({
      where: { name: Sport.UFC },
      update: {},
      create: {
        id: randomUUID(),
        name: Sport.UFC,
        participantType: 'INDIVIDUAL',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
    });

    await prisma.sportEvent.createMany({
      data: [
        {
          ...(await freshEventEdition(prisma)),
          id: eligibleEventId,
          providerId: 'integration-test',
          externalId: `events-eligible-${eligibleEventId}`,
          sport: Sport.UFC,
          name: 'Eligible UFC Event',
          startDate: new Date('2099-04-20T15:00:00.000Z'),
          endDate: new Date('2099-04-23T23:00:00.000Z'),
          status: 'SCHEDULED',
          participantCount: 144,
          metadata: {},
        },
        {
          ...(await freshEventEdition(prisma)),
          id: filteredOutEventId,
          providerId: 'integration-test',
          externalId: `events-filtered-${filteredOutEventId}`,
          sport: Sport.GOLF,
          name: 'Filtered Out Event',
          startDate: new Date('2099-04-20T15:00:00.000Z'),
          endDate: new Date('2099-04-23T23:00:00.000Z'),
          status: 'COMPLETED',
          participantCount: 12,
          metadata: {},
        },
      ],
    });

    await prisma.participant.create({
      data: {
        id: participantId,
        sport: {
          connect: {
            name: Sport.UFC,
          },
        },
        participantType: 'INDIVIDUAL',
        name: 'Ready Fighter',
      },
    });
    await prisma.sportEventParticipant.create({
      data: {
        sportEventId: eligibleEventId,
        participantId,
        isActive: true,
      },
    });

    try {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/events/?sport=UFC&status=SCHEDULED',
        headers: viewer.headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        events: [
          expect.objectContaining({
            id: eligibleEventId,
            externalId: `events-eligible-${eligibleEventId}`,
            sport: Sport.UFC,
            readinessStatus: 'CONTEST_ELIGIBLE',
            readinessReasons: [],
            contestEligible: true,
          }),
        ],
      });
    } finally {
      await prisma.sportEventParticipantGolfStanding.deleteMany({
        where: {
          standing: {
            sportEventParticipant: { sportEventId: eligibleEventId },
          },
        },
      });
      await prisma.sportEventParticipantStanding.deleteMany({
        where: {
          sportEventParticipant: { sportEventId: eligibleEventId },
        },
      });
      await prisma.sportEventParticipant.deleteMany({
        where: { sportEventId: eligibleEventId },
      });
      await prisma.participant.deleteMany({ where: { id: participantId } });
      await prisma.sportEvent.deleteMany({
        where: { id: { in: [eligibleEventId, filteredOutEventId] } },
      });
    }
  });

  it('lists a draft event, as not released, to a root admin only, and a released event whose start has passed as started', async () => {
    const prisma = getPrisma();
    const viewer = await createTestUser({ displayName: 'Events Readiness Viewer' });
    const admin = await createTestUser({ displayName: 'Events Readiness Admin', isRootAdmin: true });
    const notReleasedEventId = randomUUID();
    const lockedEventId = randomUUID();
    const participantId = randomUUID();

    await prisma.sport.upsert({
      where: { name: Sport.UFC },
      update: {},
      create: {
        id: randomUUID(),
        name: Sport.UFC,
        participantType: 'INDIVIDUAL',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
    });

    await prisma.sportEvent.createMany({
      data: [
        {
          ...(await freshEventEdition(prisma)),
          id: notReleasedEventId,
          providerId: 'integration-test',
          externalId: `events-not-released-${notReleasedEventId}`,
          sport: Sport.UFC,
          name: 'Not Released Event',
          startDate: new Date('2099-04-20T15:00:00.000Z'),
          endDate: null,
          status: 'DRAFT',
          participantCount: 100,
          metadata: {},
        },
        {
          ...(await freshEventEdition(prisma)),
          id: lockedEventId,
          providerId: 'integration-test',
          externalId: `events-locked-${lockedEventId}`,
          sport: Sport.UFC,
          name: 'Started Event',
          // Released, but its start time has passed: the contest cutoff.
          startDate: new Date('2000-04-20T15:00:00.000Z'),
          endDate: null,
          status: 'SCHEDULED',
          participantCount: 100,
          metadata: {},
        },
      ],
    });

    await prisma.participant.create({
      data: {
        id: participantId,
        sport: {
          connect: {
            name: Sport.UFC,
          },
        },
        participantType: 'INDIVIDUAL',
        name: 'Locked Fighter',
      },
    });
    await prisma.sportEventParticipant.create({
      data: {
        sportEventId: lockedEventId,
        participantId,
        isActive: true,
      },
    });

    try {
      type EventList = { events: Array<{ id: string; status: string; readinessStatus: string; readinessReasons: string[] }> };
      const adminRes = await getApp().inject({
        method: 'GET',
        url: '/api/v1/events/?sport=UFC',
        headers: admin.headers,
      });
      expect(adminRes.statusCode).toBe(200);
      const adminEvents = adminRes.json<EventList>().events;
      expect(adminEvents.find((event) => event.id === notReleasedEventId)).toMatchObject({
        status: 'DRAFT',
        readinessStatus: 'NOT_RELEASED',
        readinessReasons: ['EVENT_NOT_RELEASED', 'FIELD_NOT_LOADED'],
      });
      expect(adminEvents.find((event) => event.id === lockedEventId)).toMatchObject({
        readinessStatus: 'EVENT_STARTED',
        readinessReasons: ['EVENT_STARTED'],
      });

      const viewerRes = await getApp().inject({
        method: 'GET',
        url: '/api/v1/events/?sport=UFC',
        headers: viewer.headers,
      });
      expect(viewerRes.statusCode).toBe(200);
      const viewerIds = viewerRes.json<EventList>().events.map((event) => event.id);
      expect(viewerIds).toContain(lockedEventId);
      expect(viewerIds).not.toContain(notReleasedEventId);
    } finally {
      await prisma.sportEventParticipantGolfStanding.deleteMany({
        where: {
          standing: {
            sportEventParticipant: { sportEventId: lockedEventId },
          },
        },
      });
      await prisma.sportEventParticipantStanding.deleteMany({
        where: {
          sportEventParticipant: { sportEventId: lockedEventId },
        },
      });
      await prisma.sportEventParticipant.deleteMany({
        where: { sportEventId: lockedEventId },
      });
      await prisma.participant.deleteMany({ where: { id: participantId } });
      await prisma.sportEvent.deleteMany({
        where: { id: { in: [notReleasedEventId, lockedEventId] } },
      });
    }
  });

  describe('release for contests', () => {
    async function seedDraftGolfEvent(options: { tiered: boolean }) {
      const prisma = getPrisma();
      const eventId = randomUUID();
      const participantId = randomUUID();
      await prisma.sportEvent.create({
        data: {
          ...(await freshEventEdition(prisma)),
          id: eventId,
          providerId: 'integration-test',
          externalId: `events-release-${eventId}`,
          sport: Sport.GOLF,
          name: 'Release Route Open',
          startDate: new Date('2099-04-20T15:00:00.000Z'),
          endDate: null,
          status: 'DRAFT',
          participantCount: 1,
          metadata: {},
        },
      });
      await prisma.participant.create({
        data: {
          id: participantId,
          sport: { connect: { name: Sport.GOLF } },
          participantType: 'INDIVIDUAL',
          name: 'Release Route Golfer',
        },
      });
      const entry = await prisma.sportEventParticipant.create({
        data: { sportEventId: eventId, participantId, isActive: true },
      });
      if (options.tiered) {
        const tier = await prisma.sportEventTier.create({
          data: { sportEventId: eventId, tierKey: 'A', label: 'Tier A', tierNumber: 1, defaultPickCount: 1 },
        });
        await prisma.sportEventParticipantValuation.create({
          data: {
            sportEventParticipantId: entry.id,
            sportEventTierId: tier.id,
            tierOrderIndex: 1,
            tierAssignedSource: 'MANUAL',
          },
        });
      }
      return eventId;
    }

    const tierPayload = {
      tiers: [{ tierKey: 'A', label: 'Tier A', tierNumber: 1, defaultPickCount: 2 }],
    };

    it('releases a tiered draft for a root admin, then locks its tiers while the generic transition never releases', async () => {
      const admin = await createTestUser({ displayName: 'Release Route Admin', isRootAdmin: true });
      const eventId = await seedDraftGolfEvent({ tiered: true });

      const transitionRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/transition`,
        headers: admin.headers,
        payload: { toStatus: 'SCHEDULED' },
      });
      expect(transitionRes.statusCode).toBe(409);
      expect(transitionRes.json()).toMatchObject({ error: { code: 'SPORT_EVENT_RELEASE_REQUIRED' } });

      const draftTierRes = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/events/${eventId}/tiers`,
        headers: admin.headers,
        payload: tierPayload,
      });
      expect(draftTierRes.statusCode).toBe(200);

      const releaseRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/release`,
        headers: withoutJsonBodyHeaders(admin.headers),
      });
      expect(releaseRes.statusCode).toBe(200);
      expect(releaseRes.json()).toMatchObject({
        event: { id: eventId, status: 'SCHEDULED', readinessStatus: 'CONTEST_ELIGIBLE' },
      });

      const lockedTierRes = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/events/${eventId}/tiers`,
        headers: admin.headers,
        payload: tierPayload,
      });
      expect(lockedTierRes.statusCode).toBe(409);
      expect(lockedTierRes.json()).toMatchObject({ error: { code: 'SPORT_EVENT_TIERS_LOCKED' } });

      const againRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/release`,
        headers: withoutJsonBodyHeaders(admin.headers),
      });
      expect(againRes.statusCode).toBe(409);
      expect(againRes.json()).toMatchObject({ error: { code: 'SPORT_EVENT_NOT_DRAFT' } });
    });

    it('refuses to release a draft whose golfer has no tier with 422 SPORT_EVENT_NOT_READY and leaves it a draft', async () => {
      const admin = await createTestUser({ displayName: 'Release Untiered Admin', isRootAdmin: true });
      const eventId = await seedDraftGolfEvent({ tiered: false });

      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/release`,
        headers: withoutJsonBodyHeaders(admin.headers),
      });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: 'SPORT_EVENT_NOT_READY' } });
      const stored = await getPrisma().sportEvent.findUniqueOrThrow({ where: { id: eventId } });
      expect(stored.status).toBe('DRAFT');
    });

    it('refuses a release from a user who is not a root admin with 403 and leaves the event a draft', async () => {
      const viewer = await createTestUser({ displayName: 'Release Route Member' });
      const eventId = await seedDraftGolfEvent({ tiered: true });

      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/release`,
        headers: withoutJsonBodyHeaders(viewer.headers),
      });

      expect(res.statusCode).toBe(403);
      const stored = await getPrisma().sportEvent.findUniqueOrThrow({ where: { id: eventId } });
      expect(stored.status).toBe('DRAFT');
    });

    it('hides a draft event from a signed-in user who is not a root admin with 404 EVENT_NOT_FOUND, while a root admin reads it', async () => {
      const admin = await createTestUser({ displayName: 'Draft Read Admin', isRootAdmin: true });
      const viewer = await createTestUser({ displayName: 'Draft Read Member' });
      const eventId = await seedDraftGolfEvent({ tiered: true });

      const viewerRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}`,
        headers: viewer.headers,
      });
      expect(viewerRes.statusCode).toBe(404);
      expect(viewerRes.json()).toMatchObject({ error: { code: 'EVENT_NOT_FOUND' } });

      const adminRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}`,
        headers: admin.headers,
      });
      expect(adminRes.statusCode).toBe(200);
      expect(adminRes.json()).toMatchObject({ event: { id: eventId, status: 'DRAFT' } });
    });
  });
});
