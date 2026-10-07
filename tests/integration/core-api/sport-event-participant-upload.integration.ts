import { expect } from '@jest/globals';
import { ParticipantInactiveReason, Sport } from '@poolmaster/shared/domain';
import {
  cleanupTestData,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { SportEventError } from '../../../packages/core-api/src/modules/events/errors';
import { createSportEventParticipantService } from '../../../packages/core-api/src/modules/events/wiring';
import { freshEventEdition } from '../../support/event-edition';

// The field upload against real Postgres: it adjusts rankings, odds, seeds and withdrawals
// of golfers already on an event's field, all or none, through the grid save's write path.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

async function createField(suffix: string) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { name: Sport.GOLF },
    create: { name: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `field-upload-${suffix}`,
      providerId: 'integration-test',
      sport: 'GOLF',
      name: `Field Upload Open ${suffix}`,
      startDate: new Date('2026-05-07T12:00:00.000Z'),
      status: 'SCHEDULED',
      releaseAt: new Date('2026-05-01T12:00:00.000Z'),
      fieldLocksAt: new Date('2026-05-06T16:00:00.000Z'),
    },
  });
  const golfers = await Promise.all(['Rory McIlroy', 'Jordan Spieth', 'Tommy Fleetwood'].map(async (name, index) => {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name, participantType: 'INDIVIDUAL', externalId: `${suffix}-golfer-${index}` },
    });
    const sep = await prisma.sportEventParticipant.create({
      data: { sportEventId: event.id, participantId: participant.id, ranking: 10 + index, oddsToWin: 20 + index, seedNumber: index + 1 },
    });
    return { participant, sep };
  }));
  const offField = await prisma.participant.create({
    data: { sportId: sport.id, name: 'Off Field', participantType: 'INDIVIDUAL', externalId: `${suffix}-off-field` },
  });
  return { event, rory: golfers[0], jordan: golfers[1], tommy: golfers[2], offField };
}

async function fieldRows(sportEventId: string) {
  const rows = await getPrisma().sportEventParticipant.findMany({
    where: { sportEventId },
    orderBy: { seedNumber: 'asc' },
    select: { participantId: true, ranking: true, oddsToWin: true, seedNumber: true, isActive: true, inactiveReason: true },
  });
  // oddsToWin is a decimal column; compare it as the number the domain reads.
  return rows.map((row) => ({ ...row, oddsToWin: row.oddsToWin === null ? null : Number(row.oddsToWin) }));
}

describe('Field upload — adjusting golfers already on the field', () => {
  it('applies a mixed upload in one go: an update by each identifier, a withdrawal, a cleared value and an unchanged row', async () => {
    const { event, rory, jordan, tommy } = await createField('mixed');
    const service = createSportEventParticipantService(getPrisma());
    const rows = [
      { participantId: rory.participant.id, ranking: 1, oddsToWin: 6.5 },
      { externalId: jordan.participant.externalId as string, isActive: false, inactiveReason: ParticipantInactiveReason.WITHDRAWN, oddsToWin: null },
      { playerName: 'tommy fleetwood', ranking: 12 },
    ];

    const preview = await service.previewUpload(event.id, rows);

    expect(preview.map((row) => [row.resolution, row.change])).toEqual([
      ['MATCHED', 'UPDATE'],
      ['MATCHED', 'UPDATE'],
      ['MATCHED', 'UNCHANGED'],
    ]);
    expect((await fieldRows(event.id))[0]).toMatchObject({ ranking: 10 });

    const field = await service.applyUpload(event.id, rows);

    expect(field).toHaveLength(3);
    expect(await fieldRows(event.id)).toEqual([
      { participantId: rory.participant.id, ranking: 1, oddsToWin: 6.5, seedNumber: 1, isActive: true, inactiveReason: null },
      { participantId: jordan.participant.id, ranking: 11, oddsToWin: null, seedNumber: 2, isActive: false, inactiveReason: 'WITHDRAWN' },
      { participantId: tommy.participant.id, ranking: 12, oddsToWin: 22, seedNumber: 3, isActive: true, inactiveReason: null },
    ]);
  });

  it('refuses an upload naming a golfer not on the field with 422, leaving the field and the participants unchanged', async () => {
    const { event, rory, offField } = await createField('unresolved');
    const service = createSportEventParticipantService(getPrisma());
    const before = await fieldRows(event.id);
    const participantCount = await getPrisma().participant.count();

    const attempt = service.applyUpload(event.id, [
      { participantId: rory.participant.id, ranking: 1 },
      { externalId: offField.externalId as string, ranking: 2 },
    ]);

    await expect(attempt).rejects.toBeInstanceOf(SportEventError);
    await expect(attempt).rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_UPLOAD_ROWS_UNRESOLVED', statusCode: 422 });
    expect(await fieldRows(event.id)).toEqual(before);
    expect(await getPrisma().participant.count()).toBe(participantCount);
  });

  it('writes no row when the database rejects one of them: the patch is one transaction, all or none', async () => {
    const { event, rory, jordan } = await createField('atomic');
    const service = createSportEventParticipantService(getPrisma());
    const before = await fieldRows(event.id);

    // 2^31 is a valid integer to the contract but overflows the ranking column.
    await expect(service.applyUpload(event.id, [
      { participantId: rory.participant.id, ranking: 1 },
      { participantId: jordan.participant.id, ranking: 2 ** 31 },
    ])).rejects.toThrow();

    expect(await fieldRows(event.id)).toEqual(before);
  });
});
