import { randomUUID } from 'node:crypto';
import { createParticipant, updateParticipant } from '@poolmaster/shared/generated/hey-api';
import { buildRegisteredUser, promoteToRootAdmin } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';

// #235 — participant writes are root-admin only (A10: authority from the token claim). Before
// this slice any authenticated user could create or rename a shared catalog participant.

const createdParticipantIds: string[] = [];
let createdSportId: string | null = null;

async function golfSportId(): Promise<string> {
  const database = getFunctionalPrisma();
  const existing = await database.sport.findUnique({ where: { name: 'GOLF' } });
  if (existing) return existing.id;
  const created = await database.sport.create({ data: { name: 'GOLF', participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' } });
  createdSportId = created.id;
  return created.id;
}

afterEach(async () => {
  const database = getFunctionalPrisma();
  await database.participant.deleteMany({ where: { id: { in: createdParticipantIds.splice(0) } } });
  if (createdSportId) {
    await database.sport.deleteMany({ where: { id: createdSportId, participants: { none: {} } } });
    createdSportId = null;
  }
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Participants', () => {
  it('refuses participant create and update to a user without the root-admin claim', async () => {
    const sportId = await golfSportId();
    const existing = await getFunctionalPrisma().participant.create({
      data: { sportId, name: `FAPI Existing ${randomUUID()}`, participantType: 'INDIVIDUAL' },
    });
    createdParticipantIds.push(existing.id);
    const user = await buildRegisteredUser({ displayName: 'Participant Write Denial User' });

    const created = await createParticipant({
      client: user.client,
      body: { sportId, name: 'Should Not Exist', participantType: 'INDIVIDUAL' },
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
    const sportId = await golfSportId();
    const admin = await buildRegisteredUser({ displayName: 'Participant Write Root Admin' });
    await promoteToRootAdmin(admin);
    const name = `FAPI Created ${randomUUID()}`;

    const created = await createParticipant({
      client: admin.client,
      body: { sportId, name, participantType: 'INDIVIDUAL' },
    });
    expect(created.response.status).toBe(201);
    const participantId = created.data?.participant.id as string;
    createdParticipantIds.push(participantId);
    expect(created.data?.participant).toMatchObject({ name, sportId });

    const updated = await updateParticipant({
      client: admin.client,
      path: { id: participantId },
      body: { name: `${name} (renamed)` },
    });
    expect(updated.response.status).toBe(200);
    expect(updated.data?.participant.name).toBe(`${name} (renamed)`);
  });

  it('saves a participant update\'s external id and injury status, returning the injury dates as sent', async () => {
    const sportId = await golfSportId();
    const admin = await buildRegisteredUser({ displayName: 'Participant Update Root Admin' });
    await promoteToRootAdmin(admin);

    const created = await createParticipant({
      client: admin.client,
      body: { sportId, name: `FAPI Injury ${randomUUID()}`, participantType: 'INDIVIDUAL' },
    });
    const participantId = created.data?.participant.id as string;
    createdParticipantIds.push(participantId);

    const externalId = `ext-${randomUUID()}`;
    const updated = await updateParticipant({
      client: admin.client,
      path: { id: participantId },
      body: {
        externalId,
        injuryStatus: { status: 'OUT', detail: 'Wrist', expectedReturn: '2026-11-01T00:00:00.000Z' },
      },
    });

    expect(updated.response.status).toBe(200);
    expect(updated.data?.participant).toMatchObject({
      externalId,
      injuryStatus: { status: 'OUT', detail: 'Wrist', expectedReturn: '2026-11-01T00:00:00.000Z' },
    });
  });
});
