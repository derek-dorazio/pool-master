import { findSportRow, Sport } from '@poolmaster/shared/domain';
import {
  addEventParticipants,
  createEvent,
  createParticipant,
  createParticipantLeagueAffiliation,
  createSportLeague,
  deleteEvent,
  deleteParticipant,
  deleteSportLeague,
  getParticipant,
  getSportLeague,
  listSports,
  updateLeagueEventEmailSettings,
} from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin, type RegisteredUserContext } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, expectFunctionalError, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';

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
  await db.participantLeagueAffiliation.deleteMany({ where: { OR: [{ participantId: { in: participantIds } }, { sportLeagueId: { in: sportLeagueIds } }] } });
  await db.participantProviderMapping.deleteMany({ where: { participantId: { in: participantIds } } });
  await db.eventSeries.deleteMany({ where: { sportLeagueId: { in: sportLeagueIds } } });
  await db.sportLeague.deleteMany({ where: { id: { in: sportLeagueIds } } });
  await db.participant.deleteMany({ where: { id: { in: participantIds } } });
  await db.refreshToken.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await db.user.deleteMany({ where: { id: { in: [...created.userIds] } } });
  await cleanupFunctionalData();
  await disconnectFunctionalPrisma();
});

async function ensureGolfSportRow(): Promise<void> {
  await getFunctionalPrisma().sport.upsert({
    where: { sport: 'GOLF' },
    create: { sport: 'GOLF', participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
}

async function rootAdmin(): Promise<RegisteredUserContext> {
  const admin = await buildRegisteredUser({ displayName: 'Catalog Delete Admin' });
  created.userIds.add(admin.userId);
  await promoteToRootAdmin(admin);
  return admin;
}

async function newTour(client: Client, name: string): Promise<string> {
  const tour = await createSportLeague({ client, body: { sport: 'GOLF', name: `${name} ${RUN}` } });
  expect(tour.response?.status).toBe(201);
  const id = expectDefined(tour.data).sportLeague.id;
  created.sportLeagueIds.add(id);
  return id;
}

async function newPlayer(client: Client, name: string): Promise<string> {
  const golfSportId = expectDefined(findSportRow(expectDefined((await listSports({ client })).data).sports, Sport.GOLF)).id;
  const player = await createParticipant({
    client,
    body: { sportId: golfSportId, participantType: 'INDIVIDUAL', name: `${name} ${RUN}` },
  });
  expect(player.response?.status).toBe(201);
  const id = expectDefined(player.data).participant.id;
  created.participantIds.add(id);
  return id;
}

async function newTournament(client: Client, sportLeagueId: string, name: string): Promise<string> {
  const tournament = await createEvent({
    client,
    body: {
      name: `${name} ${RUN}`,
      startDate: '2099-07-16T08:00:00.000Z',
      endDate: '2099-07-19T20:00:00.000Z',
      rounds: 4,
      sportLeagueId,
      eventYear: 2099,
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
  it('deletes a sport league with no events, taking its affiliations and its emptied event series with it, and leaves the participant', async () => {
    const { client } = await rootAdmin();
    const sportLeagueId = await newTour(client, 'Delete Tour');
    const participantId = await newPlayer(client, 'Delete Tour Golfer');
    expect((await createParticipantLeagueAffiliation({ client, path: { sportLeagueId }, body: { participantId } })).response?.status).toBe(201);
    // A tournament made and deleted again leaves its series behind with no edition.
    const eventId = await newTournament(client, sportLeagueId, 'Delete Tour Open');
    expect((await deleteEvent({ client, path: { eventId } })).response?.status).toBe(204);

    const deleted = await deleteSportLeague({ client, path: { sportLeagueId } });

    expect(deleted.response?.status).toBe(204);
    expectFunctionalError(await getSportLeague({ client, path: { sportLeagueId } }), { status: 404, code: 'SPORT_LEAGUE_NOT_FOUND' });
    const db = getFunctionalPrisma();
    expect(await db.eventSeries.count({ where: { sportLeagueId } })).toBe(0);
    expect(await db.participantLeagueAffiliation.count({ where: { sportLeagueId } })).toBe(0);
    expect((await getParticipant({ client, path: { id: participantId } })).response?.status).toBe(200);
  });

  it('takes a deleted sport league out of every league\'s muted list, so the league can still save its event email settings', async () => {
    const { client } = await rootAdmin();
    const sportLeagueId = await newTour(client, 'Muted Tour');
    const keptId = await newTour(client, 'Kept Muted Tour');
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
    const sportLeagueId = await newTour(client, 'Busy Tour');
    await newTournament(client, sportLeagueId, 'Busy Tour Open');

    expectFunctionalError(await deleteSportLeague({ client, path: { sportLeagueId } }), { status: 409, code: 'SPORT_LEAGUE_IN_USE' });

    expect((await getSportLeague({ client, path: { sportLeagueId } })).response?.status).toBe(200);
  });

  it('deletes a participant on no event field, taking its affiliations and provider identities with it', async () => {
    const { client } = await rootAdmin();
    const sportLeagueId = await newTour(client, 'Roster Tour');
    const participantId = await newPlayer(client, 'Retired Golfer');
    expect((await createParticipantLeagueAffiliation({ client, path: { sportLeagueId }, body: { participantId } })).response?.status).toBe(201);
    const db = getFunctionalPrisma();
    await db.participantProviderMapping.create({
      data: { participantId, providerId: `functional-${RUN}`, externalId: `retired-${RUN}`, confidence: 'MANUAL' },
    });

    const deleted = await deleteParticipant({ client, path: { id: participantId } });

    expect(deleted.response?.status).toBe(204);
    expectFunctionalError(await getParticipant({ client, path: { id: participantId } }), { status: 404, code: 'PARTICIPANT_NOT_FOUND' });
    expect(await db.participantLeagueAffiliation.count({ where: { participantId } })).toBe(0);
    expect(await db.participantProviderMapping.count({ where: { participantId } })).toBe(0);
    expect((await getSportLeague({ client, path: { sportLeagueId } })).response?.status).toBe(200);
  });

  it('refuses to delete a participant on an event\'s field with 409 PARTICIPANT_IN_USE, and keeps them', async () => {
    const { client } = await rootAdmin();
    const sportLeagueId = await newTour(client, 'Field Tour');
    const participantId = await newPlayer(client, 'Entered Golfer');
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
    const sportLeagueId = await newTour(adminClient, 'Guarded Tour');
    const participantId = await newPlayer(adminClient, 'Guarded Golfer');
    const member = await buildRegisteredUser({ displayName: 'Catalog Delete Member' });
    created.userIds.add(member.userId);
    const deny = { status: 403, code: 'ROOT_ADMIN_ACCESS_REQUIRED' };

    expectFunctionalError(await deleteSportLeague({ client: member.client, path: { sportLeagueId } }), deny);
    expectFunctionalError(await deleteParticipant({ client: member.client, path: { id: participantId } }), deny);

    expect((await getSportLeague({ client: adminClient, path: { sportLeagueId } })).response?.status).toBe(200);
    expect((await getParticipant({ client: adminClient, path: { id: participantId } })).response?.status).toBe(200);
  });
});
