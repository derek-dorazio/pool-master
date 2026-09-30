import {
  cleanupTestData,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { Sport } from '@poolmaster/shared/domain';
import {
  GolfScoreError,
  GolfScoreService,
  type GolfScoreRowInput,
} from '../../../packages/core-api/src/modules/golf/golf-score-service';

// The admin round-score surface against real Postgres. A golfer's round is a core
// SportEventParticipantRound plus its golf extension, and their standing is a core
// SportEventParticipantStanding plus its golf extension; these cases assert what the
// service reads and writes across that split, not how it calls the client.

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
    create: { name: Sport.GOLF, participantType: 'INDIVIDUAL' },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      externalId: `golf-round-scores-${suffix}`,
      providerId: 'integration-test',
      sport: 'GOLF',
      name: `Round Scores Open ${suffix}`,
      startDate: new Date('2026-05-07T12:00:00.000Z'),
      status: 'IN_PROGRESS',
      releaseAt: new Date('2026-05-01T12:00:00.000Z'),
      fieldLocksAt: new Date('2026-05-06T16:00:00.000Z'),
    },
  });
  const round1 = await prisma.sportEventRound.create({
    data: { sportEventId: event.id, roundNumber: 1, scheduledDate: new Date('2026-05-07T12:00:00.000Z') },
  });
  const golfers = await Promise.all(['Rory McIlroy', 'Jordan Spieth'].map(async (name, index) => {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name, participantType: 'INDIVIDUAL', externalId: `${suffix}-golfer-${index}` },
    });
    const sep = await prisma.sportEventParticipant.create({
      data: { sportEventId: event.id, participantId: participant.id },
    });
    return { participant, sep };
  }));
  return { event, round1, rory: golfers[0], jordan: golfers[1] };
}

function row(participantId: string, overrides: Partial<GolfScoreRowInput> = {}): GolfScoreRowInput {
  return { participantId, strokes: 68, scoreToPar: -4, thru: 18, status: 'COMPLETED', ...overrides };
}

function recordingBus() {
  const published: Array<{ type: string; payload: unknown }> = [];
  return {
    published,
    bus: { publish: (type: string, payload: unknown) => { published.push({ type, payload }); return Promise.resolve(); } },
  };
}

describe('Golf round scores — admin correction surface', () => {
  it('reads every field golfer, with round scores and standing where they exist and nulls where they do not', async () => {
    const { event, round1, rory } = await createField('read');
    await getPrisma().sportEventParticipantRound.create({
      data: {
        sportEventParticipantId: rory.sep.id,
        sportEventRoundId: round1.id,
        status: 'COMPLETED',
        golf: { create: { strokes: 69, scoreToPar: -3, thru: 18 } },
      },
    });
    await getPrisma().sportEventParticipantStanding.create({
      data: {
        sportEventParticipantId: rory.sep.id,
        currentRound: 1,
        status: 'COMPLETE',
        golf: { create: { eventScoreToPar: -3, eventStrokes: 69, currentRoundThru: 18 } },
      },
    });

    const rows = await new GolfScoreService(getPrisma()).getRoundScores(event.id, 1);

    expect(rows).toEqual([
      expect.objectContaining({ participantName: 'Jordan Spieth', strokes: null, scoreToPar: null, standing: null }),
      expect.objectContaining({
        participantName: 'Rory McIlroy',
        strokes: 69,
        scoreToPar: -3,
        status: 'COMPLETED',
        standing: expect.objectContaining({ eventScoreToPar: -3, eventStrokes: 69, currentRound: 1, status: 'COMPLETE' }),
      }),
    ]);
  });

  it('previews CREATE for a new round, UNCHANGED for an identical one, UPDATE for a changed one, and never fakes a match', async () => {
    const { event, round1, rory, jordan } = await createField('preview');
    await getPrisma().sportEventParticipantRound.create({
      data: {
        sportEventParticipantId: rory.sep.id,
        sportEventRoundId: round1.id,
        status: 'COMPLETED',
        golf: { create: { strokes: 68, scoreToPar: -4, thru: 18 } },
      },
    });
    const service = new GolfScoreService(getPrisma());

    const preview = await service.previewRoundScores(event.id, 1, [
      row(rory.participant.id),
      row(jordan.participant.id),
      row(rory.participant.id, { strokes: 70, scoreToPar: -2 }),
      row('00000000-0000-4000-8000-000000000000'),
    ]);

    expect(preview.map((p) => [p.resolution, p.change])).toEqual([
      ['MATCHED', 'UNCHANGED'],
      ['MATCHED', 'CREATE'],
      ['MATCHED', 'UPDATE'],
      ['UNRESOLVED', 'CREATE'],
    ]);
    expect(preview[2].before).toEqual({ strokes: 68, scoreToPar: -4, thru: 18, status: 'COMPLETED' });
    expect(preview[3]).toMatchObject({ sportEventParticipantId: null, participantName: null, before: null });
    expect(await getPrisma().sportEventParticipantGolfRound.count({
      where: { participantRound: { sportEventParticipant: { sportEventId: event.id } } },
    })).toBe(1);
  });

  it('refuses an upload with any unresolved row with 422 ROUND_SCORE_ROWS_UNRESOLVED, and writes nothing', async () => {
    const { event, rory } = await createField('unresolved');
    const service = new GolfScoreService(getPrisma(), undefined, recordingBus().bus as never);

    const attempt = service.applyRoundScores(event.id, 1, [
      row(rory.participant.id),
      row('00000000-0000-4000-8000-000000000000'),
    ]);

    await expect(attempt).rejects.toBeInstanceOf(GolfScoreError);
    await expect(attempt).rejects.toMatchObject({ code: 'ROUND_SCORE_ROWS_UNRESOLVED', statusCode: 422 });
    expect(await getPrisma().sportEventParticipantRound.count({ where: { sportEventParticipant: { sportEventId: event.id } } })).toBe(0);
    expect(await getPrisma().sportEventParticipantStanding.count({ where: { sportEventParticipant: { sportEventId: event.id } } })).toBe(0);
  });

  it('applies an upload: core round and golf extension written together, standing recomputed, live_score.persisted published', async () => {
    const { event, rory } = await createField('apply');
    const { bus, published } = recordingBus();
    const service = new GolfScoreService(getPrisma(), undefined, bus as never);

    const rows = await service.applyRoundScores(event.id, 1, [row(rory.participant.id)]);

    const persisted = await getPrisma().sportEventParticipantRound.findMany({
      where: { sportEventParticipantId: rory.sep.id },
      include: { golf: true },
    });
    expect(persisted).toEqual([
      expect.objectContaining({ status: 'COMPLETED', golf: expect.objectContaining({ strokes: 68, scoreToPar: -4, thru: 18 }) }),
    ]);
    const standing = await getPrisma().sportEventParticipantStanding.findUniqueOrThrow({
      where: { sportEventParticipantId: rory.sep.id },
      include: { golf: true },
    });
    expect(standing).toMatchObject({
      currentRound: 1,
      status: 'COMPLETE',
      golf: { eventScoreToPar: -4, eventStrokes: 68, currentRoundThru: 18 },
    });
    expect(published).toEqual([
      expect.objectContaining({
        type: 'live_score.persisted',
        payload: expect.objectContaining({ category: 'GOLF', sportEventId: event.id, updatesPersisted: 1 }),
      }),
    ]);
    expect(rows.find((r) => r.sportEventParticipantId === rory.sep.id)).toMatchObject({ strokes: 68, scoreToPar: -4 });
  });

  it('skips a row with no strokes, as the sync path does, and still publishes that nothing persisted', async () => {
    const { event, rory } = await createField('null-strokes');
    const { bus, published } = recordingBus();
    const service = new GolfScoreService(getPrisma(), undefined, bus as never);

    await service.applyRoundScores(event.id, 1, [row(rory.participant.id, { strokes: null })]);

    expect(await getPrisma().sportEventParticipantRound.count({ where: { sportEventParticipantId: rory.sep.id } })).toBe(0);
    expect(published).toEqual([expect.objectContaining({ payload: expect.objectContaining({ updatesPersisted: 0 }) })]);
  });

  it('patches only the supplied round fields and recomputes the standing from the result', async () => {
    const { event, round1, rory } = await createField('patch');
    await getPrisma().sportEventParticipantRound.create({
      data: {
        sportEventParticipantId: rory.sep.id,
        sportEventRoundId: round1.id,
        status: 'COMPLETED',
        golf: { create: { strokes: 68, scoreToPar: -4, thru: 18 } },
      },
    });

    const updated = await new GolfScoreService(getPrisma()).updateRoundScore(event.id, 1, rory.sep.id, { strokes: 70, scoreToPar: -2 });

    expect(updated).toMatchObject({ strokes: 70, scoreToPar: -2, thru: 18, status: 'COMPLETED' });
    expect(updated.standing).toMatchObject({ eventScoreToPar: -2, eventStrokes: 70 });
  });
});
