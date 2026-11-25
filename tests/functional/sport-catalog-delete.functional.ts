import { deleteTestSportLeagues } from '../support/test-slots';
import {
  addEventParticipants,
  createParticipant,
  deleteEvent,
  deleteParticipant,
  deleteSportLeague,
  getParticipant,
  getSportLeague,
  updateLeagueEventEmailSettings,
} from '@poolmaster/shared/generated/hey-api';
import { ProviderCode } from '@poolmaster/shared/domain';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin, type RegisteredUserContext, createTestEvent } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, expectFunctionalError, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { sportRowKeys } from '../support/sport-rows';
import { Sport } from '@poolmaster/shared/domain';
import { insertTestSportLeague } from '../support/test-sport-league';

// #1400 — a root admin deletes a sport league (a tour) or a participant (a player) that nothing
// uses any more, and is refused while something still does. The e2e teardown could only make
// them inactive before, so every QA smoke run left its tour and players behind.

const RUN = `del-${Date.now()}`;
const ANY_UUID = '00000000-0000-4000-8000-000000000000';

const created = {
  sportEventIds: new Set<string>(),
  sportLeagueIds: new Set<string>(),
  participantIds: new Set<string>(),
  userIds: new Set<string>(),
};

// What a failed case leaves behind, child first. The cases delete most of it themselves.
afterAll(async () => {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  const participantIds = [...created.participantIds];
  const sportLeagueIds = [...created.sportLeagueIds];
  await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
  await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
  await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
  await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  await db.participantProviderMapping.deleteMany({ where: { participantId: { in: participantIds } } });
  await db.participant.deleteMany({ where: { id: { in: participantIds } } });
  await deleteTestSportLeagues(db, sportLeagueIds);
  await db.refreshToken.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await db.user.deleteMany({ where: { id: { in: [...created.userIds] } } });
  await cleanupFunctionalData();
  await disconnectFunctionalPrisma();
});

async function ensureGolfSportRow(): Promise<void> {
  await getFunctionalPrisma().sport.upsert({
    where: { sport: 'GOLF' },
    create: { sport: 'GOLF', ...sportRowKeys('GOLF'), tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
}

async function rootAdmin(): Promise<RegisteredUserContext> {
  const admin = await buildRegisteredUser({ displayName: 'Catalog Delete Admin' });
  created.userIds.add(admin.userId);
  await promoteToRootAdmin(admin);
  return admin;
}

async function newTour(name: string): Promise<string> {
  const { id } = await insertTestSportLeague(getFunctionalPrisma(), { sport: Sport.GOLF, name: `${name} ${RUN}` });
  created.sportLeagueIds.add(id);
  return id;
}

async function newPlayer(client: Client, sportLeagueId: string, name: string): Promise<string> {
  const player = await createParticipant({
    client,
    body: { sportLeagueId, participantType: 'INDIVIDUAL', name: `${name} ${RUN}` },
  });
  expect(player.response?.status).toBe(201);
  const id = expectDefined(player.data).participant.id;
  created.participantIds.add(id);
  return id;
}

async function newTournament(client: Client, sportLeagueId: string, name: string): Promise<string> {
  const tournament = await createTestEvent({
    client,
    body: {
      name: `${name} ${RUN}`,
      startDate: '2099-07-16T08:00:00.000Z',
      endDate: '2099-07-19T20:00:00.000Z',
      sportLeagueId,
      championshipYear: 2099,
      autoLifecycleEnabled: false,
    },
  });
  expect(tournament.response?.status).toBe(201);
  const id = expectDefined(tournament.data).event.id;
  created.sportEventIds.add(id);
  return id;
}

beforeAll(() => ensureGolfSportRow());

describe('SDK Functional: a root admin deletes a sport league or a participant nothing uses (#1400)', () => {
  it('deletes a sport league with no events and no participants, taking the test slot and Season phase its deleted event left with it', async () => {
    const { client } = await rootAdmin();
    const sportLeagueId = await newTour('Delete Tour');
    // A tournament made and deleted again leaves the league with no event.
    const eventId = await newTournament(client, sportLeagueId, 'Delete Tour Open');
    expect((await deleteEvent({ client, path: { eventId } })).response?.status).toBe(204);

    const deleted = await deleteSportLeague({ client, path: { sportLeagueId } });

    expect(deleted.response?.status).toBe(204);
    expectFunctionalError(await getSportLeague({ client, path: { sportLeagueId } }), { status: 404, code: 'SPORT_LEAGUE_NOT_FOUND' });
    const db = getFunctionalPrisma();
    expect(await db.sportLeagueSeasonCompetitionSlot.count({ where: { sportLeagueId } })).toBe(0);
    expect(await db.sportLeagueSeasonPhase.count({ where: { sportLeagueId } })).toBe(0);
  });

  it('refuses to delete a sport league that still has a participant with 409 SPORT_LEAGUE_IN_USE, and keeps both (#1853)', async () => {
    const { client } = await rootAdmin();
    const sportLeagueId = await newTour('Rostered Tour');
    const participantId = await newPlayer(client, sportLeagueId, 'Rostered Golfer');

    expectFunctionalError(await deleteSportLeague({ client, path: { sportLeagueId } }), { status: 409, code: 'SPORT_LEAGUE_IN_USE' });

    expect((await getSportLeague({ client, path: { sportLeagueId } })).response?.status).toBe(200);
    expect((await getParticipant({ client, path: { id: participantId } })).response?.status).toBe(200);
  });

  it('takes a deleted sport league out of every league\'s muted list, so the league can still save its event email settings', async () => {
    const { client } = await rootAdmin();
    const sportLeagueId = await newTour('Muted Tour');
    const keptId = await newTour('Kept Muted Tour');
    const { league, commissionerClient } = await buildLeagueWithCommissioner({ leagueName: `Muting League ${RUN}` });
    const muted = await updateLeagueEventEmailSettings({
      client: commissionerClient,
      path: { id: league.id },
      body: { mutedSportLeagueIds: [sportLeagueId, keptId], eventEmailDelivery: 'PER_EVENT' },
    });
    expect(muted.response?.status).toBe(200);

    expect((await deleteSportLeague({ client, path: { sportLeagueId } })).response?.status).toBe(204);

    const { mutedSportLeagueIds } = await getFunctionalPrisma().league.findUniqueOrThrow({ where: { id: league.id } });
    expect(mutedSportLeagueIds).toEqual([keptId]);
    // The settings page sends the league's whole list back on save.
    const saved = await updateLeagueEventEmailSettings({
      client: commissionerClient,
      path: { id: league.id },
      body: { mutedSportLeagueIds, eventEmailDelivery: 'PER_EVENT' },
    });
    expect(saved.response?.status).toBe(200);
    expect(expectDefined(saved.data).league.mutedSportLeagueIds).toEqual([keptId]);
  });

  it('refuses to delete a sport league that still has an event with 409 SPORT_LEAGUE_IN_USE, and keeps it', async () => {
    const { client } = await rootAdmin();
    const sportLeagueId = await newTour('Busy Tour');
    await newTournament(client, sportLeagueId, 'Busy Tour Open');

    expectFunctionalError(await deleteSportLeague({ client, path: { sportLeagueId } }), { status: 409, code: 'SPORT_LEAGUE_IN_USE' });

    expect((await getSportLeague({ client, path: { sportLeagueId } })).response?.status).toBe(200);
  });

  it('deletes a participant on no event field, taking its provider identities with it, and leaves its sport league', async () => {
    const { client } = await rootAdmin();
    const sportLeagueId = await newTour('Roster Tour');
    const participantId = await newPlayer(client, sportLeagueId, 'Retired Golfer');
    const db = getFunctionalPrisma();
    await db.participantProviderMapping.create({
      data: {
        participantId,
        sportLeagueId,
        providerId: (await db.provider.findUniqueOrThrow({ where: { code: ProviderCode.BALLDONTLIE } })).id,
        participantType: 'INDIVIDUAL',
        externalId: `retired-${RUN}`,
      },
    });

    const deleted = await deleteParticipant({ client, path: { id: participantId } });

    expect(deleted.response?.status).toBe(204);
    expectFunctionalError(await getParticipant({ client, path: { id: participantId } }), { status: 404, code: 'PARTICIPANT_NOT_FOUND' });
    expect(await db.participantProviderMapping.count({ where: { participantId } })).toBe(0);
    expect((await getSportLeague({ client, path: { sportLeagueId } })).response?.status).toBe(200);
  });

  it('refuses to delete a participant on an event\'s field with 409 PARTICIPANT_IN_USE, and keeps them', async () => {
    const { client } = await rootAdmin();
    const sportLeagueId = await newTour('Field Tour');
    const participantId = await newPlayer(client, sportLeagueId, 'Entered Golfer');
    const eventId = await newTournament(client, sportLeagueId, 'Field Tour Open');
    expect((await addEventParticipants({ client, path: { eventId }, body: { participantIds: [participantId] } })).response?.status).toBe(200);

    expectFunctionalError(await deleteParticipant({ client, path: { id: participantId } }), { status: 409, code: 'PARTICIPANT_IN_USE' });

    expect((await getParticipant({ client, path: { id: participantId } })).response?.status).toBe(200);
  });

  it('answers 404 for a sport league or participant that does not exist', async () => {
    const { client } = await rootAdmin();

    expectFunctionalError(await deleteSportLeague({ client, path: { sportLeagueId: ANY_UUID } }), { status: 404, code: 'SPORT_LEAGUE_NOT_FOUND' });
    expectFunctionalError(await deleteParticipant({ client, path: { id: ANY_UUID } }), { status: 404, code: 'PARTICIPANT_NOT_FOUND' });
  });

  it('refuses both deletes to a signed-in user who is not a root admin with 403, and deletes nothing', async () => {
    const { client: adminClient } = await rootAdmin();
    const sportLeagueId = await newTour('Guarded Tour');
    const participantId = await newPlayer(adminClient, sportLeagueId, 'Guarded Golfer');
    const member = await buildRegisteredUser({ displayName: 'Catalog Delete Member' });
    created.userIds.add(member.userId);
    const deny = { status: 403, code: 'ROOT_ADMIN_ACCESS_REQUIRED' };

    expectFunctionalError(await deleteSportLeague({ client: member.client, path: { sportLeagueId } }), deny);
    expectFunctionalError(await deleteParticipant({ client: member.client, path: { id: participantId } }), deny);

    expect((await getSportLeague({ client: adminClient, path: { sportLeagueId } })).response?.status).toBe(200);
    expect((await getParticipant({ client: adminClient, path: { id: participantId } })).response?.status).toBe(200);
  });
});
