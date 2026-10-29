import { randomUUID } from 'crypto';
import { Sport } from '@poolmaster/shared/domain';
import { SportEventParticipantListResponseSchema } from '@poolmaster/shared/dto';
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
import { standardEventPricing } from '../../support/budget-pricing';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('events routes', () => {
  it('filters events by status and returns contest-eligible readiness for loaded fields', async () => {
    const prisma = getPrisma();
    const viewer = await createTestUser({ displayName: 'Events Route Viewer' });
    const eligibleEventId = randomUUID();
    const filteredOutEventId = randomUUID();
    const participantId = randomUUID();

    await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      update: {},
      create: {
        id: randomUUID(),
        sport: Sport.GOLF,
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
          sport: Sport.GOLF,
          name: 'Eligible Golf Event',
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
            sport: Sport.GOLF,
          },
        },
        participantType: 'INDIVIDUAL',
        name: 'Ready Golfer',
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
        url: '/api/v1/events/?sport=GOLF&status=SCHEDULED',
        headers: viewer.headers,
      });

      expect(res.statusCode).toBe(200);
      const events = res.json<{ events: Array<{ id: string }> }>().events;
      expect(events).toContainEqual(
        expect.objectContaining({
          id: eligibleEventId,
          externalId: `events-eligible-${eligibleEventId}`,
          sport: Sport.GOLF,
          readinessStatus: 'CONTEST_ELIGIBLE',
          readinessReasons: [],
          contestEligible: true,
        }),
      );
      expect(events.map((event) => event.id)).not.toContain(filteredOutEventId);
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
      where: { sport: Sport.GOLF },
      update: {},
      create: {
        id: randomUUID(),
        sport: Sport.GOLF,
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
          sport: Sport.GOLF,
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
          sport: Sport.GOLF,
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
            sport: Sport.GOLF,
          },
        },
        participantType: 'INDIVIDUAL',
        name: 'Locked Golfer',
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
        url: '/api/v1/events/?sport=GOLF',
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
        url: '/api/v1/events/?sport=GOLF',
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
          sport: { connect: { sport: Sport.GOLF } },
          participantType: 'INDIVIDUAL',
          name: 'Release Route Golfer',
        },
      });
      const entry = await prisma.sportEventParticipant.create({
        data: { sportEventId: eventId, participantId, isActive: true },
      });
      if (options.tiered) {
        const tier = await prisma.sportEventTier.create({
          data: { sportEventId: eventId, tierKey: 'A', label: 'Tier A', tierNumber: 1 },
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
      tiers: [{ tierKey: 'A', label: 'Tier A', tierNumber: 1 }],
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

      const unpricedRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/release`,
        headers: withoutJsonBodyHeaders(admin.headers),
      });
      expect(unpricedRes.statusCode).toBe(422);
      const unpriced = unpricedRes.json<{ error: { code: string; message: string } }>();
      expect(unpriced.error.code).toBe('SPORT_EVENT_NOT_READY');
      expect(unpriced.error.message).toContain('its prices have not been assigned');

      const pricesRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/prices/auto-assign`,
        headers: admin.headers,
        payload: standardEventPricing(),
      });
      expect(pricesRes.statusCode).toBe(200);
      expect(SportEventParticipantListResponseSchema.safeParse(pricesRes.json()).success).toBe(true);
      expect(pricesRes.json()).toMatchObject({ participants: [{ valuation: { price: 12000, priceAssignedSource: 'AUTO_RANKING' } }] });

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
      expect(releaseRes.json()).toMatchObject({ event: { pricing: standardEventPricing() } });

      const lockedPricesRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/prices/auto-assign`,
        headers: admin.headers,
        payload: { ...standardEventPricing(), salaryCap: 5000, unit: 10 },
      });
      expect(lockedPricesRes.statusCode).toBe(409);
      expect(lockedPricesRes.json()).toMatchObject({ error: { code: 'SPORT_EVENT_TIERS_LOCKED' } });

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

    it('refuses to release a tiered, priced draft that has an empty tier with 422 SPORT_EVENT_NOT_READY naming the tier, and leaves it a draft', async () => {
      const admin = await createTestUser({ displayName: 'Release Empty Tier Admin', isRootAdmin: true });
      const eventId = await seedDraftGolfEvent({ tiered: true });
      await getPrisma().sportEventTier.create({
        data: { sportEventId: eventId, tierKey: 'B', label: 'Tier B', tierNumber: 2 },
      });
      const pricesRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/prices/auto-assign`,
        headers: admin.headers,
        payload: standardEventPricing(),
      });
      expect(pricesRes.statusCode).toBe(200);

      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/release`,
        headers: withoutJsonBodyHeaders(admin.headers),
      });

      expect(res.statusCode).toBe(422);
      const body = res.json<{ error: { code: string; message: string } }>();
      expect(body.error.code).toBe('SPORT_EVENT_NOT_READY');
      expect(body.error.message).toContain('Tier B has no golfers');
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

    it('lists a sport league\'s DRAFT-only year to a root admin but not to a signed-in user who is not one', async () => {
      const prisma = getPrisma();
      const admin = await createTestUser({ displayName: 'Years Read Admin', isRootAdmin: true });
      const viewer = await createTestUser({ displayName: 'Years Read Member' });
      const sport = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
      const sportLeague = await prisma.sportLeague.create({ data: { sportId: sport.id, name: `Years Route Tour ${randomUUID()}` } });
      const series = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: 'Years Route Classic' } });
      await prisma.sportEvent.createMany({
        data: [
          { eventYear: 2098, status: 'SCHEDULED' as const, startDate: new Date('2098-04-20T15:00:00.000Z') },
          { eventYear: 2099, status: 'DRAFT' as const, startDate: new Date('2099-04-20T15:00:00.000Z') },
        ].map((edition) => ({
          ...edition,
          eventSeriesId: series.id,
          providerId: 'integration-test',
          externalId: `events-years-${randomUUID()}`,
          sport: Sport.GOLF,
          name: 'Years Route Classic',
        })),
      });
      const url = `/api/v1/events/years?sportLeagueId=${sportLeague.id}`;

      const viewerRes = await getApp().inject({ method: 'GET', url, headers: viewer.headers });
      expect(viewerRes.statusCode).toBe(200);
      expect(viewerRes.json()).toEqual({ years: [2098] });

      const adminRes = await getApp().inject({ method: 'GET', url, headers: admin.headers });
      expect(adminRes.statusCode).toBe(200);
      expect(adminRes.json()).toEqual({ years: [2099, 2098] });
    });
  });
});

describe('editing an event moves its round schedule with it', () => {
  it('moves every stored round by the start date\'s shift and schedules the rounds an admin adds, in Postgres', async () => {
    const prisma = getPrisma();
    const admin = await createTestUser({ displayName: 'Round Schedule Admin', isRootAdmin: true });
    const eventId = randomUUID();
    await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        id: eventId,
        providerId: 'integration-test',
        externalId: `events-round-shift-${eventId}`,
        sport: Sport.GOLF,
        name: 'Round Shift Open',
        startDate: new Date('2099-06-04T12:00:00.000Z'),
        status: 'DRAFT',
        rounds: 2,
        metadata: {},
      },
    });
    await prisma.sportEventRound.createMany({
      data: [
        { sportEventId: eventId, roundNumber: 1, scheduledDate: new Date('2099-06-04T12:00:00.000Z'), scheduledEndAt: new Date('2099-06-04T22:00:00.000Z') },
        { sportEventId: eventId, roundNumber: 2, scheduledDate: new Date('2099-06-06T12:00:00.000Z') },
      ],
    });

    const res = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/events/${eventId}`,
      headers: admin.headers,
      payload: { startDate: '2099-06-11T12:00:00.000Z', rounds: 3 },
    });

    expect(res.statusCode).toBe(200);
    const rounds = await prisma.sportEventRound.findMany({ where: { sportEventId: eventId }, orderBy: { roundNumber: 'asc' } });
    expect(rounds.map((round) => [round.roundNumber, round.scheduledDate.toISOString(), round.scheduledEndAt?.toISOString() ?? null])).toEqual([
      [1, '2099-06-11T12:00:00.000Z', '2099-06-11T22:00:00.000Z'],
      [2, '2099-06-13T12:00:00.000Z', null],
      // The added round follows the last one by a day, so it keeps the irregular schedule.
      [3, '2099-06-14T12:00:00.000Z', null],
    ]);

    await prisma.sportEventRound.deleteMany({ where: { sportEventId: eventId } });
    await prisma.sportEvent.delete({ where: { id: eventId } });
  });
});
