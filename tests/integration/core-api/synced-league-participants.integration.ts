/**
 * #2096, #2075 — participants of a provider-synced sport league, and removing a test slot, against
 * real Postgres and the routes as index.ts registers them. A synced league takes a participant only
 * with its sync provider's feed id, written with the mapping, or as a test participant; a test
 * participant joins only a test slot's event, is on no roster, and goes with its test slot.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Sport } from '@poolmaster/shared/domain';
import type { ParticipantListResponse } from '@poolmaster/shared/dto/participants.dto';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, createTestUser, getApp, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests, withoutJsonBodyHeaders } from '../helpers';
import { syncLeagueTo } from '../../support/league-sync';
import { createSportEventRow } from '../../support/sport-event-rows';
import { deleteTestSportLeagues, testSlotId } from '../../support/test-slots';
import { insertTestSportLeague } from '../../support/test-sport-league';

/** What a participant create answers. */
type ParticipantResponse = { participant: { id: string } };

const createdSportLeagueIds: string[] = [];

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const leagues = { sportLeagueId: { in: createdSportLeagueIds } };
  const events = new PrismaSportEventRepository(getPrisma());
  for (const { id } of await getPrisma().sportEvent.findMany({ where: leagues, select: { id: true } })) await events.delete(id);
  await getPrisma().participantProviderMapping.deleteMany({ where: leagues });
  await getPrisma().participant.deleteMany({ where: leagues });
  await deleteTestSportLeagues(getPrisma(), createdSportLeagueIds);
  await cleanupTestData();
  await teardownIntegrationTests();
});

/** A golf league of the test's own, synced from BALLDONTLIE's PGA TOUR unless `synced` is false. */
async function golfLeague(synced = true): Promise<string> {
  const { id } = await insertTestSportLeague(getPrisma(), { sport: Sport.GOLF, name: `Participants Tour ${randomUUID()}` });
  createdSportLeagueIds.push(id);
  if (synced) await syncLeagueTo(getPrisma(), id, 'pga');
  return id;
}

async function rootAdminHeaders() {
  return (await createTestUser({ displayName: 'Synced Participants Admin', isRootAdmin: true })).headers;
}

function createParticipant(headers: Record<string, string>, payload: Record<string, unknown>) {
  return getApp().inject({ method: 'POST', url: '/api/v1/participants', headers, payload: { participantType: 'INDIVIDUAL', ...payload } });
}

/** A test event on a new test slot of the league's current Season, made through the API. */
async function testEvent(headers: Record<string, string>, sportLeagueId: string): Promise<{ eventId: string; slotId: string }> {
  const slotId = await testSlotId(getPrisma(), sportLeagueId, new Date('2084-06-16T08:00:00.000Z'), new Date('2084-06-19T20:00:00.000Z'));
  const response = await getApp().inject({
    method: 'POST', url: '/api/v1/events', headers, payload: { name: `Test Open ${randomUUID()}`, seasonSlotIds: [slotId], autoLifecycleEnabled: false },
  });
  expect(response.statusCode).toBe(201);
  return { eventId: response.json<{ event: { id: string } }>().event.id, slotId };
}

describe('Creating a participant in a provider-synced sport league (#2096)', () => {
  it('refuses one with no feed id with 409 PARTICIPANT_FEED_ID_REQUIRED, writing nothing', async () => {
    const headers = await rootAdminHeaders();
    const sportLeagueId = await golfLeague();

    const response = await createParticipant(headers, { sportLeagueId, name: 'Unmapped Golfer' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'PARTICIPANT_FEED_ID_REQUIRED' } });
    await expect(getPrisma().participant.count({ where: { sportLeagueId } })).resolves.toBe(0);
  });

  it('writes one with the sync provider\'s feed id together with its mapping at that provider, and refuses the same feed id again with 409', async () => {
    const headers = await rootAdminHeaders();
    const sportLeagueId = await golfLeague();
    const feedId = `golfer-${randomUUID()}`;

    const created = await createParticipant(headers, { sportLeagueId, name: 'Mapped Golfer', feedId });
    const again = await createParticipant(headers, { sportLeagueId, name: 'Mapped Golfer Twin', feedId });

    expect(created.statusCode).toBe(201);
    const participantId = created.json<ParticipantResponse>().participant.id;
    const provider = await getPrisma().providerLeague.findFirstOrThrow({ where: { code: 'pga' }, select: { providerId: true } });
    await expect(getPrisma().participantProviderMapping.findMany({ where: { participantId }, select: { providerId: true, externalId: true, sportLeagueId: true } }))
      .resolves.toEqual([{ providerId: provider.providerId, externalId: feedId, sportLeagueId }]);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'PARTICIPANT_FEED_ID_TAKEN' } });
    await expect(getPrisma().participant.count({ where: { sportLeagueId } })).resolves.toBe(1);
  });

  it('writes a test participant with no mapping, leaves it off the league\'s roster but lists it with testData=true, and refuses binding it a feed id with 422', async () => {
    const headers = await rootAdminHeaders();
    const sportLeagueId = await golfLeague();

    const created = await createParticipant(headers, { sportLeagueId, name: 'Test Golfer', isTestData: true });
    const participantId = created.json<ParticipantResponse>().participant.id;
    const roster = await getApp().inject({ method: 'GET', url: `/api/v1/sport-leagues/${sportLeagueId}/participants`, headers });
    const testChoices = await getApp().inject({ method: 'GET', url: `/api/v1/sport-leagues/${sportLeagueId}/participants?testData=true`, headers });
    const bound = await getApp().inject({
      method: 'POST', url: `/api/v1/participants/${participantId}/provider-mappings`, headers,
      payload: { providerId: (await getPrisma().providerLeague.findFirstOrThrow({ where: { code: 'pga' } })).providerId, externalId: 'golfer-1' },
    });

    expect(created.statusCode).toBe(201);
    await expect(getPrisma().participant.findUniqueOrThrow({ where: { id: participantId }, select: { isTestData: true } })).resolves.toEqual({ isTestData: true });
    expect(roster.json<ParticipantListResponse>().participants).toEqual([]);
    expect(testChoices.json<ParticipantListResponse>().participants.map((participant) => participant.id)).toEqual([participantId]);
    expect(bound.statusCode).toBe(422);
    expect(bound.json()).toMatchObject({ error: { code: 'TEST_PARTICIPANT_FEED_ID' } });
    await expect(getPrisma().participantProviderMapping.count({ where: { participantId } })).resolves.toBe(0);
  });

  it('puts a test participant on a test slot\'s event, and refuses it on an event the sync keeps with 422 TEST_PARTICIPANT_NOT_ON_TEST_SLOT', async () => {
    const headers = await rootAdminHeaders();
    const sportLeagueId = await golfLeague();
    const participantId = (await createParticipant(headers, { sportLeagueId, name: 'Field Test Golfer', isTestData: true })).json<ParticipantResponse>().participant.id;
    const { eventId } = await testEvent(headers, sportLeagueId);
    const { currentSeasonId } = await getPrisma().sportLeague.findUniqueOrThrow({ where: { id: sportLeagueId }, select: { currentSeasonId: true } });
    const synced = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
      sportLeagueId, sportLeagueSeasonId: currentSeasonId ?? '', name: `Synced Open ${randomUUID()}`, startDate: new Date('2084-07-01T12:00:00.000Z'), status: 'DRAFT', autoLifecycleEnabled: false,
    });

    const onTest = await getApp().inject({ method: 'POST', url: `/api/v1/events/${eventId}/participants`, headers, payload: { participantIds: [participantId] } });
    const onSynced = await getApp().inject({ method: 'POST', url: `/api/v1/events/${synced.id}/participants`, headers, payload: { participantIds: [participantId] } });

    expect(onTest.statusCode).toBe(200);
    expect(onSynced.statusCode).toBe(422);
    expect(onSynced.json()).toMatchObject({ error: { code: 'TEST_PARTICIPANT_NOT_ON_TEST_SLOT' } });
    await expect(getPrisma().sportEventParticipant.count({ where: { sportEventId: synced.id } })).resolves.toBe(0);
  });

  it('leaves a league with no feed as it was: a participant with no feed id is written, and a feed id is refused with 422 SPORT_LEAGUE_NOT_SYNCED', async () => {
    const headers = await rootAdminHeaders();
    const sportLeagueId = await golfLeague(false);

    const plain = await createParticipant(headers, { sportLeagueId, name: 'Plain Golfer' });
    const withFeedId = await createParticipant(headers, { sportLeagueId, name: 'Feed Golfer', feedId: 'golfer-2' });

    expect(plain.statusCode).toBe(201);
    expect(withFeedId.statusCode).toBe(422);
    expect(withFeedId.json()).toMatchObject({ error: { code: 'SPORT_LEAGUE_NOT_SYNCED' } });
  });
});

describe('Removing a test slot (#2075)', () => {
  it('removes the slot, its event, and the test participants of its field no other field holds, keeping one another test event still fields and one never on its field', async () => {
    const headers = await rootAdminHeaders();
    const sportLeagueId = await golfLeague();
    const only = (await createParticipant(headers, { sportLeagueId, name: 'Only Here', isTestData: true })).json<ParticipantResponse>().participant.id;
    const shared = (await createParticipant(headers, { sportLeagueId, name: 'Also Elsewhere', isTestData: true })).json<ParticipantResponse>().participant.id;
    // On no field at all, as a journey's players are between their create and its field add.
    const bystander = (await createParticipant(headers, { sportLeagueId, name: 'Not Yet Fielded', isTestData: true })).json<ParticipantResponse>().participant.id;
    const removed = await testEvent(headers, sportLeagueId);
    const kept = await testEvent(headers, sportLeagueId);
    await getApp().inject({ method: 'POST', url: `/api/v1/events/${removed.eventId}/participants`, headers, payload: { participantIds: [only, shared] } });
    await getApp().inject({ method: 'POST', url: `/api/v1/events/${kept.eventId}/participants`, headers, payload: { participantIds: [shared] } });

    const response = await getApp().inject({ method: 'DELETE', url: `/api/v1/sport-leagues/${sportLeagueId}/test-slots/${removed.slotId}`, headers: withoutJsonBodyHeaders(headers) });

    expect(response.statusCode).toBe(204);
    await expect(getPrisma().sportLeagueSeasonCompetitionSlot.count({ where: { id: removed.slotId } })).resolves.toBe(0);
    await expect(getPrisma().sportEvent.count({ where: { id: removed.eventId } })).resolves.toBe(0);
    await expect(getPrisma().participant.findMany({ where: { sportLeagueId }, select: { id: true }, orderBy: { id: 'asc' } }))
      .resolves.toEqual([shared, bystander].sort().map((id) => ({ id })));
    await expect(getPrisma().sportEvent.count({ where: { id: kept.eventId } })).resolves.toBe(1);
  });

  it('refuses a slot the sync keeps with 422 SEASON_SLOT_NOT_TEST, and another league\'s slot with 404, removing nothing', async () => {
    const headers = await rootAdminHeaders();
    const sportLeagueId = await golfLeague();
    const otherLeagueId = await golfLeague();
    const slotId = await testSlotId(getPrisma(), sportLeagueId, new Date('2084-08-01T12:00:00.000Z'));
    await getPrisma().sportLeagueSeasonCompetitionSlot.update({ where: { id: slotId }, data: { isTestData: false, label: null } });
    const otherSlotId = await testSlotId(getPrisma(), otherLeagueId, new Date('2084-08-01T12:00:00.000Z'));

    const synced = await getApp().inject({ method: 'DELETE', url: `/api/v1/sport-leagues/${sportLeagueId}/test-slots/${slotId}`, headers: withoutJsonBodyHeaders(headers) });
    const elsewhere = await getApp().inject({ method: 'DELETE', url: `/api/v1/sport-leagues/${sportLeagueId}/test-slots/${otherSlotId}`, headers: withoutJsonBodyHeaders(headers) });

    expect(synced.statusCode).toBe(422);
    expect(synced.json()).toMatchObject({ error: { code: 'SEASON_SLOT_NOT_TEST' } });
    expect(elsewhere.statusCode).toBe(404);
    await expect(getPrisma().sportLeagueSeasonCompetitionSlot.count({ where: { id: { in: [slotId, otherSlotId] } } })).resolves.toBe(2);
  });
});
