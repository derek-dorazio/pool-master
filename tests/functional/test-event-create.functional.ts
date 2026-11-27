import { createEvent, createTestSlot, deleteEvent, getEvent, listEventRounds, updateEvent } from '@poolmaster/shared/generated/hey-api';
import { Sport } from '@poolmaster/shared/domain';
import { enUS } from '@poolmaster/shared/display-strings';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { addRunSportLeague, buildRegisteredUser, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, expectFunctionalError, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { fixtureSeasonId } from '../support/event-edition';
import { deleteTestSportLeagues, testSlotDefinitionId, testSlotIdIn, uniqueTestSlotLabel } from '../support/test-slots';

// #2004 — a test event is made by hand only on a free test slot of its league's current Season,
// and takes the slot's dates; every other slot is the sync's. A test slot is added through the API.

const RUN = `tev-${Date.now()}`;
const ANY_UUID = '00000000-0000-4000-8000-000000000000';
const created = { sportLeagueIds: new Set<string>(), sportEventIds: new Set<string>(), userIds: new Set<string>() };

let client: Client;
let sportLeagueId: string;
let slotDefinitionId: string;

beforeAll(async () => {
  const admin = await buildRegisteredUser({ displayName: 'Test Event Admin' });
  created.userIds.add(admin.userId);
  await promoteToRootAdmin(admin);
  client = admin.client;
  sportLeagueId = await addRunSportLeague(Sport.GOLF, `Test Event Tour ${RUN}`);
  created.sportLeagueIds.add(sportLeagueId);
  const { currentSeasonId } = await getFunctionalPrisma().sportLeague.findUniqueOrThrow({ where: { id: sportLeagueId }, select: { currentSeasonId: true } });
  slotDefinitionId = await testSlotDefinitionId(getFunctionalPrisma(), sportLeagueId, expectDefined(currentSeasonId ?? undefined));
});

afterAll(async () => {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  // A round is played in one of its event's slots (#2006), so the rounds go first.
  await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
  await db.sportEventSlot.deleteMany({ where: { sportEventId: { in: eventIds } } });
  await db.sportEventSlotTier.deleteMany({ where: { slot: { sportEventId: { in: eventIds } } } });
  await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  await deleteTestSportLeagues(db, [...created.sportLeagueIds]);
  await db.refreshToken.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await db.user.deleteMany({ where: { id: { in: [...created.userIds] } } });
  await cleanupFunctionalData();
  await disconnectFunctionalPrisma();
});

async function newTestSlot(startsAt: string, endsAt?: string): Promise<string> {
  const slot = await createTestSlot({ client, path: { sportLeagueId }, body: { slotDefinitionId, label: uniqueTestSlotLabel(), startsAt, ...(endsAt !== undefined && { endsAt }) } });
  expect(slot.response?.status).toBe(201);
  return expectDefined(slot.data).slot.id;
}

describe('createTestSlot', () => {
  it('adds a labelled test slot to the current Season on the definition it plays', async () => {
    const label = uniqueTestSlotLabel();
    const slot = await createTestSlot({ client, path: { sportLeagueId }, body: { slotDefinitionId, label, startsAt: '2026-06-01T12:00:00.000Z', endsAt: '2026-06-04T22:00:00.000Z' } });
    expect(slot.response?.status).toBe(201);
    expect(expectDefined(slot.data).slot).toMatchObject({ label, isTestData: true, startsAt: '2026-06-01T12:00:00.000Z', endsAt: '2026-06-04T22:00:00.000Z' });
  });

  it('refuses a slot that ends before it starts with 422 TEST_SLOT_ENDS_BEFORE_START', async () => {
    const slot = await createTestSlot({ client, path: { sportLeagueId }, body: { slotDefinitionId, label: uniqueTestSlotLabel(), startsAt: '2026-06-04T12:00:00.000Z', endsAt: '2026-06-01T12:00:00.000Z' } });
    expectFunctionalError(slot, { status: 422, code: 'TEST_SLOT_ENDS_BEFORE_START' });
  });

  it('refuses a second test slot with the same label on the same definition with 409 TEST_SLOT_LABEL_TAKEN', async () => {
    const label = uniqueTestSlotLabel();
    const body = { slotDefinitionId, label, startsAt: '2026-07-01T12:00:00.000Z' };
    expect((await createTestSlot({ client, path: { sportLeagueId }, body })).response?.status).toBe(201);
    expectFunctionalError(await createTestSlot({ client, path: { sportLeagueId }, body }), { status: 409, code: 'TEST_SLOT_LABEL_TAKEN' });
  });

  it('refuses a definition whose competition the current Season does not have with 422 SLOT_COMPETITION_NOT_IN_SEASON, not a 500', async () => {
    const db = getFunctionalPrisma();
    const phase = await db.sportLeaguePhase.create({ data: { sportLeagueId, phase: 'POSTSEASON', isSynced: true }, select: { id: true } });
    const competition = await db.sportLeagueCompetition.create({ data: { sportLeagueId, sportLeaguePhaseId: phase.id, leaguePhase: 'POSTSEASON', code: 'POSTSEASON', orderIndex: 1 }, select: { id: true } });
    const definition = await db.sportLeagueCompetitionSlot.create({
      data: {
        sportLeagueId, sportLeagueCompetitionId: competition.id, key: 'FINAL', slotKind: 'TOURNAMENT', awardsTrophy: false, squaresEligible: true, isNeutralSite: false,
        seriesFormat: 'SINGLE_GAME', seriesGames: 1, pairing: 'FIXED', matchFormat: 'HEAD_TO_HEAD', canEndTied: false,
      },
      select: { id: true },
    });
    const slot = await createTestSlot({ client, path: { sportLeagueId }, body: { slotDefinitionId: definition.id, label: uniqueTestSlotLabel(), startsAt: '2026-06-01T12:00:00.000Z' } });
    expectFunctionalError(slot, { status: 422, code: 'SLOT_COMPETITION_NOT_IN_SEASON' });
    expect(enUS.error.SLOT_COMPETITION_NOT_IN_SEASON).toBeTruthy();
  });

  it('refuses a definition that is not the league\'s with 404 SLOT_DEFINITION_NOT_FOUND', async () => {
    const slot = await createTestSlot({ client, path: { sportLeagueId }, body: { slotDefinitionId: ANY_UUID, label: uniqueTestSlotLabel(), startsAt: '2026-06-01T12:00:00.000Z' } });
    expectFunctionalError(slot, { status: 404, code: 'SLOT_DEFINITION_NOT_FOUND' });
  });
});

describe('createEvent on a season slot', () => {
  it('makes a draft test event on a free test slot, with the slot\'s dates and the slot listed', async () => {
    const seasonSlotId = await newTestSlot('2026-08-06T12:00:00.000Z', '2026-08-09T22:00:00.000Z');
    const made = await createEvent({ client, body: { seasonSlotIds: [seasonSlotId], name: `Slot Open ${RUN}` } });
    expect(made.response?.status).toBe(201);
    const event = expectDefined(made.data).event;
    created.sportEventIds.add(event.id);
    expect(event).toMatchObject({ status: 'DRAFT', isTestData: true, startDate: '2026-08-06T12:00:00.000Z', endDate: '2026-08-09T22:00:00.000Z' });
    expect(event.slots.map((slot) => slot.id)).toEqual([seasonSlotId]);
    const read = expectDefined((await getEvent({ client, path: { eventId: event.id } })).data).event;
    expect(read.slots.map((slot) => slot.id)).toEqual([seasonSlotId]);
  });

  it('plays the rounds asked for in a one-slot test event\'s slot, and reads them back as its round count', async () => {
    const seasonSlotId = await newTestSlot('2026-10-01T12:00:00.000Z', '2026-10-04T22:00:00.000Z');
    const event = expectDefined((await createEvent({ client, body: { seasonSlotIds: [seasonSlotId], name: `One Slot Open ${RUN}`, rounds: 4 } })).data).event;
    created.sportEventIds.add(event.id);
    expect(event.roundCount).toBe(4);
    const rounds = expectDefined((await listEventRounds({ client, path: { eventId: event.id } })).data).rounds;
    expect(rounds.map((round) => [round.roundNumber, round.slot.seasonSlotId])).toEqual([1, 2, 3, 4].map((roundNumber) => [roundNumber, seasonSlotId]));
  });

  it('refuses a round count for a multi-slot test event with 422 EVENT_ROUNDS_FROM_SLOTS, and the refusal has en-US copy', async () => {
    const seasonSlotIds = [await newTestSlot('2026-10-22T12:00:00.000Z'), await newTestSlot('2026-10-29T12:00:00.000Z')];
    expectFunctionalError(await createEvent({ client, body: { seasonSlotIds, name: `Fixed Rounds Open ${RUN}`, rounds: 3 } }), { status: 422, code: 'EVENT_ROUNDS_FROM_SLOTS' });
    expect(enUS.error.EVENT_ROUNDS_FROM_SLOTS).toBeTruthy();
  });

  it('makes a multi-slot test event with one round per slot, in the order the slots are given, dated by each slot', async () => {
    const firstSlotId = await newTestSlot('2026-10-08T12:00:00.000Z');
    const secondSlotId = await newTestSlot('2026-10-15T12:00:00.000Z');
    const made = await createEvent({ client, body: { seasonSlotIds: [firstSlotId, secondSlotId], name: `Two Slot Open ${RUN}` } });
    expect(made.response?.status).toBe(201);
    const event = expectDefined(made.data).event;
    created.sportEventIds.add(event.id);
    expect(event.slots.map((slot) => slot.id).sort()).toEqual([firstSlotId, secondSlotId].sort());
    const rounds = expectDefined((await listEventRounds({ client, path: { eventId: event.id } })).data).rounds;
    expect(rounds.map((round) => [round.roundNumber, round.slot.seasonSlotId])).toEqual([[1, firstSlotId], [2, secondSlotId]]);
    expect(rounds.map((round) => round.scheduledDate)).toEqual(['2026-10-08T12:00:00.000Z', '2026-10-15T12:00:00.000Z']);
  });

  it('refuses slots of two Seasons with 422 SEASON_SLOTS_NOT_ONE_SEASON', async () => {
    const db = getFunctionalPrisma();
    const currentSlotId = await newTestSlot('2026-11-05T12:00:00.000Z');
    const pastSlotId = await testSlotIdIn(db, sportLeagueId, await fixtureSeasonId(db, sportLeagueId, 2018), new Date('2018-08-06T12:00:00.000Z'));
    expectFunctionalError(await createEvent({ client, body: { seasonSlotIds: [currentSlotId, pastSlotId], name: `Two Season Open ${RUN}` } }), { status: 422, code: 'SEASON_SLOTS_NOT_ONE_SEASON' });
    expect(enUS.error.SEASON_SLOTS_NOT_ONE_SEASON).toBeTruthy();
  });

  it('refuses a date edit of an event whose dates come from its slots with 422 EVENT_DATES_FROM_SLOTS', async () => {
    const seasonSlotId = await newTestSlot('2026-08-13T12:00:00.000Z');
    const event = expectDefined((await createEvent({ client, body: { seasonSlotIds: [seasonSlotId], name: `Dated Open ${RUN}` } })).data).event;
    created.sportEventIds.add(event.id);
    const edit = await updateEvent({ client, path: { eventId: event.id }, body: { startDate: '2026-09-01T12:00:00.000Z' } });
    expectFunctionalError(edit, { status: 422, code: 'EVENT_DATES_FROM_SLOTS' });
    expect(enUS.error.EVENT_DATES_FROM_SLOTS).toBeTruthy();
  });

  it('refuses a slot the sync keeps with 422 SEASON_SLOT_NOT_TEST, and the refusal has en-US copy', async () => {
    const db = getFunctionalPrisma();
    const seasonSlotId = await testSlotIdIn(db, sportLeagueId, expectDefined((await db.sportLeague.findUniqueOrThrow({ where: { id: sportLeagueId } })).currentSeasonId ?? undefined), new Date('2026-08-20T12:00:00.000Z'));
    await db.sportLeagueSeasonCompetitionSlot.update({ where: { id: seasonSlotId }, data: { isTestData: false, label: null } });
    expectFunctionalError(await createEvent({ client, body: { seasonSlotIds: [seasonSlotId], name: `Synced Open ${RUN}` } }), { status: 422, code: 'SEASON_SLOT_NOT_TEST' });
    expect(enUS.error.SEASON_SLOT_NOT_TEST).toBe('Events can be made by hand only on a test slot.');
  });

  it('refuses a test slot outside the league\'s current Season with 422 SEASON_SLOT_NOT_CURRENT', async () => {
    const db = getFunctionalPrisma();
    const pastSeasonId = await fixtureSeasonId(db, sportLeagueId, 2019);
    const seasonSlotId = await testSlotIdIn(db, sportLeagueId, pastSeasonId, new Date('2019-08-06T12:00:00.000Z'));
    expectFunctionalError(await createEvent({ client, body: { seasonSlotIds: [seasonSlotId], name: `Old Open ${RUN}` } }), { status: 422, code: 'SEASON_SLOT_NOT_CURRENT' });
    expect(enUS.error.SEASON_SLOT_NOT_CURRENT).toBeTruthy();
  });

  it('refuses a test slot that already has an event with 409 SEASON_SLOT_TAKEN', async () => {
    const seasonSlotId = await newTestSlot('2026-08-27T12:00:00.000Z');
    const first = expectDefined((await createEvent({ client, body: { seasonSlotIds: [seasonSlotId], name: `Taken Open ${RUN}` } })).data).event;
    created.sportEventIds.add(first.id);
    expectFunctionalError(await createEvent({ client, body: { seasonSlotIds: [seasonSlotId], name: `Second Open ${RUN}` } }), { status: 409, code: 'SEASON_SLOT_TAKEN' });
    expect(enUS.error.SEASON_SLOT_TAKEN).toBeTruthy();
  });

  it('answers one of two creates racing for the same free slot with 409 SEASON_SLOT_TAKEN, never a 500', async () => {
    const seasonSlotId = await newTestSlot('2026-09-10T12:00:00.000Z');
    const results = await Promise.all([
      createEvent({ client, body: { seasonSlotIds: [seasonSlotId], name: `Race A Open ${RUN}` } }),
      createEvent({ client, body: { seasonSlotIds: [seasonSlotId], name: `Race B Open ${RUN}` } }),
    ]);
    for (const result of results) if (result.data) created.sportEventIds.add(result.data.event.id);
    expect(results.map((result) => result.response?.status ?? 0).sort((left, right) => left - right)).toEqual([201, 409]);
    const refused = expectDefined(results.find((result) => result.response?.status === 409));
    expectFunctionalError(refused, { status: 409, code: 'SEASON_SLOT_TAKEN' });
  });

  it('refuses a slot id that names no slot with 404 SEASON_SLOT_NOT_FOUND', async () => {
    expectFunctionalError(await createEvent({ client, body: { seasonSlotIds: [ANY_UUID], name: `Nowhere Open ${RUN}` } }), { status: 404, code: 'SEASON_SLOT_NOT_FOUND' });
  });

  it('frees the test slot when its event is deleted, so another event can be made on it', async () => {
    const seasonSlotId = await newTestSlot('2026-09-03T12:00:00.000Z');
    const first = expectDefined((await createEvent({ client, body: { seasonSlotIds: [seasonSlotId], name: `Freed Open ${RUN}` } })).data).event;
    expect((await deleteEvent({ client, path: { eventId: first.id } })).response?.status).toBe(204);
    const second = await createEvent({ client, body: { seasonSlotIds: [seasonSlotId], name: `Freed Open ${RUN}` } });
    expect(second.response?.status).toBe(201);
    created.sportEventIds.add(expectDefined(second.data).event.id);
  });
});
