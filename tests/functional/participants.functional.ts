import { deleteTestSportLeagues, testSlotId } from '../support/test-slots';
import { randomUUID } from 'node:crypto';
import { createParticipant, deleteTestSlot, updateParticipant } from '@poolmaster/shared/generated/hey-api';
import { syncLeagueTo } from '../support/league-sync';
import { insertTestSportLeague } from '../support/test-sport-league';
import { Sport } from '@poolmaster/shared/domain';
import { buildRegisteredUser, promoteToRootAdmin } from './builders';
import { sportLeagueRowDefaults } from '../support/league-profiles';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';
import { sportRowKeys } from '../support/sport-rows';
import { sportPlay } from '../support/sport-play';

// #235 — participant writes are root-admin only (A10: authority from the token claim). Before
// this slice any authenticated user could create or rename a shared catalog participant.

const createdParticipantIds: string[] = [];
const createdSportLeagueIds: string[] = [];

/** A golf tour of the run's own, which each participant here belongs to (#1853). */
async function golfTourId(): Promise<string> {
  const database = getFunctionalPrisma();
  const sport = await database.sport.upsert({
    where: { sport: 'GOLF' },
    create: { sport: 'GOLF', ...sportRowKeys('GOLF'), tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const tour = await database.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(database)), ...sportPlay(sport.sport), sportId: sport.id, name: `FAPI Tour ${randomUUID()}` } });
  createdSportLeagueIds.push(tour.id);
  return tour.id;
}

afterEach(async () => {
  const database = getFunctionalPrisma();
  await database.participantProviderMapping.deleteMany({ where: { sportLeagueId: { in: createdSportLeagueIds } } });
  await database.participant.deleteMany({ where: { OR: [{ id: { in: createdParticipantIds.splice(0) } }, { sportLeagueId: { in: createdSportLeagueIds } }] } });
  await deleteTestSportLeagues(database, createdSportLeagueIds.splice(0));
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Participants', () => {
  it('refuses participant create and update to a user without the root-admin claim', async () => {
    const sportLeagueId = await golfTourId();
    const existing = await getFunctionalPrisma().participant.create({
      data: { sportLeagueId, name: `FAPI Existing ${randomUUID()}`, participantType: 'INDIVIDUAL' },
    });
    createdParticipantIds.push(existing.id);
    const user = await buildRegisteredUser({ displayName: 'Participant Write Denial User' });

    const created = await createParticipant({
      client: user.client,
      body: { sportLeagueId, name: 'Should Not Exist', participantType: 'INDIVIDUAL' },
    });
    expectFunctionalError(created, { status: 403, code: 'ROOT_ADMIN_ACCESS_REQUIRED' });

    const updated = await updateParticipant({
      client: user.client,
      path: { id: existing.id },
      body: { name: 'Renamed By Anyone' },
    });
    expectFunctionalError(updated, { status: 403, code: 'ROOT_ADMIN_ACCESS_REQUIRED' });

    const unchanged = await getFunctionalPrisma().participant.findUniqueOrThrow({ where: { id: existing.id } });
    expect(unchanged.name).toBe(existing.name);
    await expect(getFunctionalPrisma().participant.count({ where: { name: 'Should Not Exist' } })).resolves.toBe(0);
  });

  it('lets a root admin create and then update a participant', async () => {
    const sportLeagueId = await golfTourId();
    const admin = await buildRegisteredUser({ displayName: 'Participant Write Root Admin' });
    await promoteToRootAdmin(admin);
    const name = `FAPI Created ${randomUUID()}`;

    const created = await createParticipant({
      client: admin.client,
      body: { sportLeagueId, name, participantType: 'INDIVIDUAL' },
    });
    expect(created.response?.status).toBe(201);
    const participantId = created.data?.participant.id as string;
    createdParticipantIds.push(participantId);
    expect(created.data?.participant).toMatchObject({ name, sportLeagueId, ranking: null });

    const updated = await updateParticipant({
      client: admin.client,
      path: { id: participantId },
      body: { name: `${name} (renamed)` },
    });
    expect(updated.response?.status).toBe(200);
    expect(updated.data?.participant.name).toBe(`${name} (renamed)`);
  });

  it('in a provider-synced league, creates a participant with the feed id or as test data, refuses one with neither with 409, and removes a test slot with 204', async () => {
    const { id: sportLeagueId } = await insertTestSportLeague(getFunctionalPrisma(), { sport: Sport.GOLF, name: `FAPI Synced Tour ${randomUUID()}` });
    createdSportLeagueIds.push(sportLeagueId);
    await syncLeagueTo(getFunctionalPrisma(), sportLeagueId, 'pga');
    const admin = await buildRegisteredUser({ displayName: 'Synced Participant Root Admin' });
    await promoteToRootAdmin(admin);
    const create = (body: { name: string; feedId?: string; isTestData?: boolean }) => createParticipant({
      client: admin.client, body: { sportLeagueId, participantType: 'INDIVIDUAL', ...body },
    });

    const mapped = await create({ name: `FAPI Mapped ${randomUUID()}`, feedId: `fapi-${randomUUID()}` });
    const test = await create({ name: `FAPI Test ${randomUUID()}`, isTestData: true });
    const unmapped = await create({ name: `FAPI Unmapped ${randomUUID()}` });
    const slotId = await testSlotId(getFunctionalPrisma(), sportLeagueId, new Date('2087-04-10T12:00:00.000Z'));
    const removed = await deleteTestSlot({ client: admin.client, path: { sportLeagueId, seasonSlotId: slotId } });

    expect(mapped.response?.status).toBe(201);
    expect(test.response?.status).toBe(201);
    expectFunctionalError(unmapped, { status: 409, code: 'PARTICIPANT_FEED_ID_REQUIRED' });
    expect(removed.response?.status).toBe(204);
    await expect(getFunctionalPrisma().sportLeagueSeasonPhaseSlot.count({ where: { id: slotId } })).resolves.toBe(0);
    // The test participant was on no field, so the slot's removal took it too.
    await expect(getFunctionalPrisma().participant.count({ where: { id: test.data?.participant.id } })).resolves.toBe(0);
  });

  it('saves a participant update\'s injury status, returning the injury dates as sent', async () => {
    const sportLeagueId = await golfTourId();
    const admin = await buildRegisteredUser({ displayName: 'Participant Update Root Admin' });
    await promoteToRootAdmin(admin);

    const created = await createParticipant({
      client: admin.client,
      body: { sportLeagueId, name: `FAPI Injury ${randomUUID()}`, participantType: 'INDIVIDUAL' },
    });
    const participantId = created.data?.participant.id as string;
    createdParticipantIds.push(participantId);

    const updated = await updateParticipant({
      client: admin.client,
      path: { id: participantId },
      body: {
        injuryStatus: { status: 'OUT', detail: 'Wrist', expectedReturn: '2026-11-01T00:00:00.000Z' },
      },
    });

    expect(updated.response?.status).toBe(200);
    expect(updated.data?.participant).toMatchObject({
      injuryStatus: { status: 'OUT', detail: 'Wrist', expectedReturn: '2026-11-01T00:00:00.000Z' },
    });
  });
});
