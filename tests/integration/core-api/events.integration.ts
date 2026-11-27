import { randomUUID } from 'crypto';
import { Sport } from '@poolmaster/shared/domain';
import { SportEventParticipantListResponseSchema, type SportEventListResponse } from '@poolmaster/shared/dto';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import { eventRoundSlots, fixtureSeasonId, freshEventEdition } from '../../support/event-edition';
import { standardPricingIn } from '../../support/budget-pricing';
import { inTierSet, tierSetSlot } from '../../support/event-tier-sets';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { participantLeagueIdForSport } from '../../support/participant-league';
import { sportRowKeys } from '../../support/sport-rows';
import { sportPlay } from '../../support/sport-play';
import { linkTestSlot, oneEventSlotId } from '../../support/test-slots';
import { createMatchRow } from '../../support/match-rows';

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
        ...sportRowKeys(Sport.GOLF),
      },
    });

    await prisma.sportEvent.createMany({
      data: [
        {
          ...(await freshEventEdition(prisma)),
          id: eligibleEventId,
          name: 'Eligible Golf Event',
          startDate: new Date('2099-04-20T15:00:00.000Z'),
          endDate: new Date('2099-04-23T23:00:00.000Z'),
          status: 'SCHEDULED',
        },
        {
          ...(await freshEventEdition(prisma)),
          id: filteredOutEventId,
          name: 'Filtered Out Event',
          startDate: new Date('2099-04-20T15:00:00.000Z'),
          endDate: new Date('2099-04-23T23:00:00.000Z'),
          status: 'COMPLETED',
        },
      ],
    });

    await prisma.participant.create({
      data: {
        id: participantId,
        sportLeagueId: await participantLeagueIdForSport(prisma, Sport.GOLF),
        participantType: 'INDIVIDUAL',
        name: 'Ready Golfer',
      },
    });
    await prisma.sportEventParticipant.create({
      data: {
        sportEventId: eligibleEventId,
        participantId,
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
          providerMappings: [],
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
        ...sportRowKeys(Sport.GOLF),
      },
    });

    await prisma.sportEvent.createMany({
      data: [
        {
          ...(await freshEventEdition(prisma)),
          id: notReleasedEventId,
          name: 'Not Released Event',
          startDate: new Date('2099-04-20T15:00:00.000Z'),
          endDate: null,
          status: 'DRAFT',
        },
        {
          ...(await freshEventEdition(prisma)),
          id: lockedEventId,
          name: 'Started Event',
          // Released, but its start time has passed: the contest cutoff.
          startDate: new Date('2000-04-20T15:00:00.000Z'),
          endDate: null,
          status: 'SCHEDULED',
        },
      ],
    });

    await prisma.participant.create({
      data: {
        id: participantId,
        sportLeagueId: await participantLeagueIdForSport(prisma, Sport.GOLF),
        participantType: 'INDIVIDUAL',
        name: 'Locked Golfer',
      },
    });
    await prisma.sportEventParticipant.create({
      data: {
        sportEventId: lockedEventId,
        participantId,
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
        url: '/api/v1/events/?sport=GOLF&status=SCHEDULED&status=POSTPONED&status=IN_PROGRESS',
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
    /**
     * A draft PGA TOUR event on a test slot of a tournament its seeded tiered and budget setups
     * cover, so its tiers and prices are release checks.
     */
    async function seedDraftGolfEvent(options: { tiered: boolean }) {
      const prisma = getPrisma();
      const eventId = randomUUID();
      const participantId = randomUUID();
      const event = await prisma.sportEvent.create({
        data: {
          ...(await freshEventEdition(prisma, { onPgaTour: true })),
          id: eventId,
          name: 'Release Route Open',
          startDate: new Date('2099-04-20T15:00:00.000Z'),
          endDate: null,
          status: 'DRAFT',
        },
      });
      await linkTestSlot(prisma, event);
      await prisma.participant.create({
        data: {
          id: participantId,
          sportLeagueId: await participantLeagueIdForSport(prisma, Sport.GOLF),
          participantType: 'INDIVIDUAL',
          name: 'Release Route Golfer',
        },
      });
      const entry = await prisma.sportEventParticipant.create({
        // A rank gives the field an order to tier and price by (#2040: never by name).
        data: { sportEventId: eventId, participantId, ranking: 1 },
      });
      // Its one slot holds its tiers and prices (#2044).
      const slot = await tierSetSlot(prisma, eventId);
      if (options.tiered) {
        const tier = await prisma.sportEventSlotTier.create({
          data: { sportEventSlotId: slot.id, tierKey: 'A', tierNumber: 1 },
        });
        await prisma.sportEventSlotParticipantValuation.create({
          data: {
            ...inTierSet(slot),
            sportEventParticipantId: entry.id,
            sportEventSlotTierId: tier.id,
            tierOrderIndex: 1,
            tierAssignedSource: 'MANUAL',
          },
        });
      }
      return eventId;
    }

    const tierPayload = {
      tiers: [{ tierKey: 'A', tierNumber: 1 }],
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
        payload: await standardPricingIn(getPrisma()),
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
      expect(releaseRes.json()).toMatchObject({ event: { pricing: await standardPricingIn(getPrisma()) } });

      const lockedPricesRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/prices/auto-assign`,
        headers: admin.headers,
        payload: { ...(await standardPricingIn(getPrisma())), salaryCap: 5000, unit: 10 },
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

    it('prices with the profile a request names by id and records that id, dropping a profile name sent with it like any unknown key (#2205)', async () => {
      const admin = await createTestUser({ displayName: 'Price By Id Admin', isRootAdmin: true });
      const eventId = await seedDraftGolfEvent({ tiered: true });
      const standard = await standardPricingIn(getPrisma());

      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/prices/auto-assign`,
        headers: admin.headers,
        payload: { ...standard, profileName: 'Standard' },
      });

      expect(res.statusCode).toBe(200);
      const stored = await getPrisma().sportEventSlot.findFirstOrThrow({ where: { sportEventId: eventId }, select: { platformPricingProfileId: true, salaryCap: true } });
      expect(stored).toEqual({ platformPricingProfileId: standard.platformPricingProfileId, salaryCap: standard.salaryCap });
    });

    it('refuses to price with a pricing profile id there is no profile for with 404 PLATFORM_PRICING_PROFILE_NOT_FOUND and records no pricing (#2205)', async () => {
      const admin = await createTestUser({ displayName: 'Price Unknown Profile Admin', isRootAdmin: true });
      const eventId = await seedDraftGolfEvent({ tiered: true });

      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/prices/auto-assign`,
        headers: admin.headers,
        payload: { ...(await standardPricingIn(getPrisma())), platformPricingProfileId: randomUUID() },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'PLATFORM_PRICING_PROFILE_NOT_FOUND' } });
      const stored = await getPrisma().sportEventSlot.findFirstOrThrow({ where: { sportEventId: eventId }, select: { platformPricingProfileId: true, salaryCap: true } });
      expect(stored).toEqual({ platformPricingProfileId: null, salaryCap: null });
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

    it('refuses to release a tiered, priced draft that has an empty tier with 422 SPORT_EVENT_NOT_READY naming the tier by its number, and leaves it a draft', async () => {
      const admin = await createTestUser({ displayName: 'Release Empty Tier Admin', isRootAdmin: true });
      const eventId = await seedDraftGolfEvent({ tiered: true });
      await getPrisma().sportEventSlotTier.create({
        data: { sportEventSlotId: (await tierSetSlot(getPrisma(), eventId)).id, tierKey: 'B', tierNumber: 2 },
      });
      const pricesRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/prices/auto-assign`,
        headers: admin.headers,
        payload: await standardPricingIn(getPrisma()),
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
      expect(body.error.message).toContain('Tier 2 has no golfers');
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

    it('lists a Season\'s DRAFT event to a root admin but leaves it out for a signed-in user who is not one', async () => {
      const prisma = getPrisma();
      const admin = await createTestUser({ displayName: 'Season List Admin', isRootAdmin: true });
      const viewer = await createTestUser({ displayName: 'Season List Member' });
      const sport = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
      const sportLeague = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Season List Tour ${randomUUID()}` } });
      const sportLeagueSeasonId = await fixtureSeasonId(prisma, sportLeague.id, 2098);
      await prisma.sportEvent.createMany({
        data: [
          { sportLeagueId: sportLeague.id, status: 'SCHEDULED' as const, startDate: new Date('2098-04-20T15:00:00.000Z'), name: 'Season List Classic' },
          { sportLeagueId: sportLeague.id, status: 'DRAFT' as const, startDate: new Date('2098-05-20T15:00:00.000Z'), name: 'Season List Open' },
        ].map((edition) => ({
          ...edition,
          sportLeagueSeasonId,
        })),
      });
      const url = `/api/v1/events?sportLeagueSeasonId=${sportLeagueSeasonId}`;

      const viewerRes = await getApp().inject({ method: 'GET', url, headers: viewer.headers });
      expect(viewerRes.statusCode).toBe(200);
      expect(viewerRes.json<SportEventListResponse>().events.map((event) => event.name)).toEqual(['Season List Classic']);

      const adminRes = await getApp().inject({ method: 'GET', url, headers: admin.headers });
      expect(adminRes.statusCode).toBe(200);
      expect(adminRes.json<SportEventListResponse>().events.map((event) => event.name).sort()).toEqual(['Season List Classic', 'Season List Open']);
    });
  });
});

describe('editing an event\'s round count adds rounds in its slot', () => {
  it('schedules the rounds an admin adds to a one-slot event a day after its last, in the same slot, in Postgres', async () => {
    const prisma = getPrisma();
    const admin = await createTestUser({ displayName: 'Round Schedule Admin', isRootAdmin: true });
    const eventId = randomUUID();
    await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        id: eventId,
        name: 'Round Shift Open',
        startDate: new Date('2099-06-04T12:00:00.000Z'),
        status: 'DRAFT',
        rounds: 2,
      },
    });
    const sportEventSlotId = await oneEventSlotId(prisma, eventId);
    await prisma.sportEventRound.createMany({
      data: [
        { sportEventId: eventId, sportEventSlotId, roundNumber: 1, scheduledDate: new Date('2099-06-04T12:00:00.000Z'), scheduledEndAt: new Date('2099-06-04T22:00:00.000Z') },
        { sportEventId: eventId, sportEventSlotId, roundNumber: 2, scheduledDate: new Date('2099-06-06T12:00:00.000Z') },
      ],
    });

    const res = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/events/${eventId}`,
      headers: admin.headers,
      payload: { rounds: 3 },
    });

    expect(res.statusCode).toBe(200);
    const rounds = await prisma.sportEventRound.findMany({ where: { sportEventId: eventId }, orderBy: { roundNumber: 'asc' } });
    expect(rounds.map((round) => [round.roundNumber, round.scheduledDate.toISOString(), round.scheduledEndAt?.toISOString() ?? null, round.sportEventSlotId])).toEqual([
      [1, '2099-06-04T12:00:00.000Z', '2099-06-04T22:00:00.000Z', sportEventSlotId],
      [2, '2099-06-06T12:00:00.000Z', null, sportEventSlotId],
      // The added round follows the last one by a day, so it keeps the irregular schedule.
      [3, '2099-06-07T12:00:00.000Z', null, sportEventSlotId],
    ]);

    await prisma.sportEventRound.deleteMany({ where: { sportEventId: eventId } });
    await prisma.sportEvent.delete({ where: { id: eventId } });
  });
});

describe('each slot a tiered or budget template lists holds its own tier set (#2044)', () => {
  it('reads, edits and prices a later listed slot on its slot routes while the tier-set slot keeps its own, refuses an unknown slot with 404 and a slot no such template lists with 409', async () => {
    const prisma = getPrisma();
    const admin = await createTestUser({ displayName: 'Slot Tier Admin', isRootAdmin: true });
    const event = await prisma.sportEvent.create({
      data: { ...(await freshEventEdition(prisma, { onPgaTour: true })), id: randomUUID(), name: 'Slot Tier Open', startDate: new Date('2099-04-20T15:00:00.000Z'), endDate: null, status: 'DRAFT' },
    });
    const slotIds = await eventRoundSlots(prisma, event.id, [{ slotKind: 'PLAY_IN' }, { slotKind: 'ROUND_OF_64' }, { slotKind: 'ROUND_OF_32' }]);
    const slots = await prisma.sportEventSlot.findMany({
      where: { id: { in: slotIds } },
      select: { id: true, sportLeagueSeasonCompetitionSlotId: true, seasonSlot: { select: { sportLeagueCompetitionSlotId: true } } },
    });
    const [playIn, roundOf64, roundOf32] = slotIds.map((id) => {
      const slot = slots.find((row) => row.id === id);
      if (!slot) throw new Error(`Slot ${id} was not made`);
      return slot;
    });
    // Tiered contests may start at the round of 64 or the round of 32; only a bracket lists the play-in.
    const template = { sportLeagueId: event.sportLeagueId, coverageMode: 'ONE_SLOT', contestFormat: 'ROSTER', name: 'Setup', description: 'Setup', sortOrder: 1, configJson: {} } as const;
    const templateIds: string[] = [];
    for (const [selectionType, slot] of [['TIERED', roundOf64], ['BUDGET_PICK', roundOf32], ['BRACKET', playIn]] as const) {
      // poolmaster-allow-query-in-loop: three templates, each with the slot it lists
      templateIds.push((await prisma.contestConfigTemplate.create({
        data: { ...template, selectionType, active: true, templateKey: `slot-tiers-${randomUUID()}`, slots: { create: { sportLeagueCompetitionSlotId: slot.seasonSlot.sportLeagueCompetitionSlotId } } },
        select: { id: true },
      })).id);
    }
    const participant = await prisma.participant.create({
      data: { id: randomUUID(), sportLeagueId: await participantLeagueIdForSport(prisma, Sport.GOLF), participantType: 'INDIVIDUAL', name: 'Slot Tier Golfer' },
    });
    await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id, ranking: 1 } });
    const slotUrl = (seasonSlotId: string, path: string) => `/api/v1/events/${event.id}/slots/${seasonSlotId}/${path}`;
    const inject = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) => getApp().inject({
      method, url, headers: payload ? admin.headers : withoutJsonBodyHeaders(admin.headers), ...(payload ? { payload } : {}),
    });

    try {
      const later = roundOf32.sportLeagueSeasonCompetitionSlotId;
      const replaced = await inject('PUT', slotUrl(later, 'tiers'), { tiers: [{ tierKey: 'A', tierNumber: 1 }, { tierKey: 'B', tierNumber: 2 }] });
      expect(replaced.statusCode).toBe(200);
      const assigned = await inject('POST', slotUrl(later, 'tiers/auto-assign'), {});
      expect(assigned.statusCode).toBe(200);
      const priced = await inject('POST', slotUrl(later, 'prices/auto-assign'), await standardPricingIn(prisma));
      expect(priced.statusCode).toBe(200);
      expect(SportEventParticipantListResponseSchema.safeParse(priced.json()).success).toBe(true);

      const [laterTiers, tierSetTiers, laterField, tierSetField] = await Promise.all([
        inject('GET', slotUrl(later, 'tiers')),
        inject('GET', `/api/v1/events/${event.id}/tiers`),
        inject('GET', slotUrl(later, 'participants')),
        inject('GET', `/api/v1/events/${event.id}/participants`),
      ]);
      const laterTierList = laterTiers.json<{ tiers: Array<{ id: string; tierKey: string }> }>().tiers;
      expect(laterTierList.map((tier) => tier.tierKey)).toEqual(['A', 'B']);
      expect(tierSetTiers.json<{ tiers: unknown[] }>().tiers).not.toHaveLength(2);
      expect(laterField.json()).toMatchObject({ participants: [{ valuation: { price: 12000, sportEventTierId: laterTierList[0]?.id } }] });
      expect(tierSetField.json<{ participants: Array<{ valuation?: { price?: number | null } | null }> }>().participants[0]?.valuation?.price ?? null).toBeNull();
      expect(await prisma.sportEventSlotTier.count({ where: { sportEventSlotId: roundOf32.id } })).toBe(2);
      expect(await prisma.sportEventSlotTier.count({ where: { sportEventSlotId: roundOf64.id, tierKey: 'B', tierNumber: 2 } })).toBe(0);

      const unknown = await inject('GET', slotUrl(randomUUID(), 'tiers'));
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json()).toMatchObject({ error: { code: 'SPORT_EVENT_SLOT_NOT_FOUND' } });
      const noSet = await inject('PUT', slotUrl(playIn.sportLeagueSeasonCompetitionSlotId, 'tiers'), { tiers: [{ tierKey: 'A', tierNumber: 1 }] });
      expect(noSet.statusCode).toBe(409);
      expect(noSet.json()).toMatchObject({ error: { code: 'SLOT_HOLDS_NO_TIER_SET' } });
      expect(await prisma.sportEventSlotTier.count({ where: { sportEventSlotId: playIn.id } })).toBe(0);
    } finally {
      // The setups have no rules of their own: other tests list every template.
      await prisma.contestConfigTemplate.deleteMany({ where: { id: { in: templateIds } } });
    }
  });

  it('tiers a later slot from the teams that lost no decided game in an earlier slot, in Postgres: a loser is left out, a team on a bye and both teams of an unplayed game are in', async () => {
    const prisma = getPrisma();
    const admin = await createTestUser({ displayName: 'Still In Admin', isRootAdmin: true });
    const event = await prisma.sportEvent.create({
      data: { ...(await freshEventEdition(prisma, { onPgaTour: true })), id: randomUUID(), name: 'Still In Open', startDate: new Date('2099-04-20T15:00:00.000Z'), endDate: null, status: 'DRAFT' },
    });
    const [roundOf64SlotId, roundOf32SlotId] = await eventRoundSlots(prisma, event.id, [{ slotKind: 'ROUND_OF_64' }, { slotKind: 'ROUND_OF_32' }]);
    const slots = await prisma.sportEventSlot.findMany({
      where: { sportEventId: event.id },
      select: { id: true, sportLeagueSeasonCompetitionSlotId: true, seasonSlot: { select: { sportLeagueCompetitionSlotId: true } } },
    });
    const later = slots.find((slot) => slot.id === roundOf32SlotId);
    if (!later) throw new Error('The round of 32 slot was not made');
    // A tiered contest may start at either round, so each holds a set.
    const template = await prisma.contestConfigTemplate.create({
      data: {
        sportLeagueId: event.sportLeagueId, coverageMode: 'ONE_SLOT', contestFormat: 'ROSTER', name: 'Setup', description: 'Setup', sortOrder: 1, configJson: {},
        selectionType: 'TIERED', active: true, templateKey: `still-in-${randomUUID()}`,
        slots: { create: slots.map((slot) => ({ sportLeagueCompetitionSlotId: slot.seasonSlot.sportLeagueCompetitionSlotId })) },
      },
      select: { id: true },
    });
    const participantLeagueId = await participantLeagueIdForSport(prisma, Sport.GOLF);
    const names = ['Loser', 'Winner', 'Unplayed One', 'Unplayed Two', 'Bye'];
    const rows = new Map<string, string>();
    const row = (name: string) => {
      const id = rows.get(name);
      if (id === undefined) throw new Error(`No field row for ${name}`);
      return id;
    };
    for (const [index, name] of names.entries()) {
      // poolmaster-allow-query-in-loop: five teams, each with its field row
      const participant = await prisma.participant.create({ data: { sportLeagueId: participantLeagueId, participantType: 'INDIVIDUAL', name: `Still In ${name}` } });
      rows.set(name, (await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id, ranking: index + 1 } })).id);
    }
    const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId: roundOf64SlotId, roundNumber: 1, scheduledDate: new Date('2099-04-20T15:00:00.000Z') } });
    const game = (matchNumber: number, teams: readonly [string, string], result?: { winnerSideNumber: number; scores: readonly [number, number] }) => createMatchRow(prisma, {
      sportEventId: event.id, sportEventRoundId: round.id, sportEventSlotId: round.sportEventSlotId, matchNumber, teams, isNeutralSite: true, ...(result ? { result } : {}),
    });
    await game(1, [row('Loser'), row('Winner')], { winnerSideNumber: 2, scores: [1, 3] });
    await game(2, [row('Unplayed One'), row('Unplayed Two')]);
    const slotRoute = (path: string) => `/api/v1/events/${event.id}/slots/${later.sportLeagueSeasonCompetitionSlotId}/${path}`;

    try {
      expect((await getApp().inject({ method: 'PUT', url: slotRoute('tiers'), headers: admin.headers, payload: { tiers: [{ tierKey: 'A', tierNumber: 1 }] } })).statusCode).toBe(200);
      expect((await getApp().inject({ method: 'POST', url: slotRoute('tiers/auto-assign'), headers: admin.headers, payload: {} })).statusCode).toBe(200);

      const tiered = await prisma.sportEventSlotParticipantValuation.findMany({
        where: { sportEventSlotId: later.id, sportEventSlotTierId: { not: null } },
        select: { sportEventParticipantId: true },
      });
      const nameOf = new Map([...rows].map(([name, id]) => [id, name]));
      expect(tiered.map((row) => nameOf.get(row.sportEventParticipantId) ?? '').sort((left, right) => left.localeCompare(right))).toEqual(['Bye', 'Unplayed One', 'Unplayed Two', 'Winner']);
    } finally {
      await prisma.contestConfigTemplate.deleteMany({ where: { id: template.id } });
    }
  });

  it('keeps a later listed slot editable on its slot route once the event is released, while the tier-set slot locks', async () => {
    const prisma = getPrisma();
    const admin = await createTestUser({ displayName: 'Released Slot Tier Admin', isRootAdmin: true });
    const event = await prisma.sportEvent.create({
      data: { ...(await freshEventEdition(prisma, { onPgaTour: true })), id: randomUUID(), name: 'Released Slot Tier Open', startDate: new Date('2099-04-20T15:00:00.000Z'), endDate: null, status: 'SCHEDULED' },
    });
    const slotIds = await eventRoundSlots(prisma, event.id, [{ slotKind: 'ROUND_OF_64' }, { slotKind: 'ROUND_OF_32' }]);
    const slots = await prisma.sportEventSlot.findMany({
      where: { id: { in: slotIds } },
      select: { id: true, sportLeagueSeasonCompetitionSlotId: true, seasonSlot: { select: { sportLeagueCompetitionSlotId: true } } },
    });
    const [first, later] = slotIds.map((id) => {
      const slot = slots.find((row) => row.id === id);
      if (!slot) throw new Error(`Slot ${id} was not made`);
      return slot;
    });
    const created = await prisma.contestConfigTemplate.create({
      data: {
        sportLeagueId: event.sportLeagueId, coverageMode: 'ONE_SLOT', contestFormat: 'ROSTER', name: 'Setup', description: 'Setup', sortOrder: 1, configJson: {},
        selectionType: 'TIERED', active: true, templateKey: `released-slot-tiers-${randomUUID()}`,
        slots: { create: [first, later].map((slot) => ({ sportLeagueCompetitionSlotId: slot.seasonSlot.sportLeagueCompetitionSlotId })) },
      },
      select: { id: true },
    });
    const payload = { tiers: [{ tierKey: 'A', tierNumber: 1 }] };
    const put = (seasonSlotId: string) => getApp().inject({ method: 'PUT', url: `/api/v1/events/${event.id}/slots/${seasonSlotId}/tiers`, headers: admin.headers, payload });

    try {
      const [lockedRes, laterRes] = [await put(first.sportLeagueSeasonCompetitionSlotId), await put(later.sportLeagueSeasonCompetitionSlotId)];
      expect([lockedRes.statusCode, laterRes.statusCode]).toEqual([409, 200]);
      expect(lockedRes.json()).toMatchObject({ error: { code: 'SPORT_EVENT_TIERS_LOCKED' } });
    } finally {
      await prisma.contestConfigTemplate.deleteMany({ where: { id: created.id } });
    }
  });
});
