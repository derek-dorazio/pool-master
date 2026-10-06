import { expect } from '@jest/globals';
import type { SportEventParticipantResponse } from '@poolmaster/shared/dto';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { Sport } from '@poolmaster/shared/domain';
import {
  GolfScoreError,
  type GolfScoreRowInput,
} from '../../../packages/core-api/src/modules/golf/golf-score-service';
import { createGolfScoreService, createSportEventServices } from '../../../packages/core-api/src/modules/events/wiring';
import { freshEventEdition } from '../../support/event-edition';

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
    create: { name: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
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

    // #236 — the per-round score read is the field read now: every field row with its
    // rounds and standing, each carrying its golf extension.
    const views = await createSportEventServices(getPrisma()).field.listEventParticipants(event.id);
    const byName = new Map(views.map((view) => [view.participant.name, view]));

    expect(byName.get('Jordan Spieth')).toMatchObject({ rounds: [], standing: null });
    expect(byName.get('Rory McIlroy')).toMatchObject({
      rounds: [expect.objectContaining({ round: expect.objectContaining({ roundNumber: 1, status: 'COMPLETED' }), golf: expect.objectContaining({ strokes: 69, scoreToPar: -3 }) })],
      standing: {
        standing: expect.objectContaining({ currentRound: 1, status: 'COMPLETE' }),
        golf: expect.objectContaining({ eventScoreToPar: -3, eventStrokes: 69 }),
      },
    });
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
    const service = createGolfScoreService(getPrisma());

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
    const service = createGolfScoreService(getPrisma());

    const attempt = service.applyRoundScores(event.id, 1, [
      row(rory.participant.id),
      row('00000000-0000-4000-8000-000000000000'),
    ]);

    await expect(attempt).rejects.toBeInstanceOf(GolfScoreError);
    await expect(attempt).rejects.toMatchObject({ code: 'ROUND_SCORE_ROWS_UNRESOLVED', statusCode: 422 });
    expect(await getPrisma().sportEventParticipantRound.count({ where: { sportEventParticipant: { sportEventId: event.id } } })).toBe(0);
    expect(await getPrisma().sportEventParticipantStanding.count({ where: { sportEventParticipant: { sportEventId: event.id } } })).toBe(0);
  });

  it('applies an upload: core round and golf extension written together, standing recomputed', async () => {
    const { event, rory } = await createField('apply');
    const service = createGolfScoreService(getPrisma());

    await service.applyRoundScores(event.id, 1, [row(rory.participant.id)]);

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
  });

  it('skips a row with no strokes, as the sync path does, persisting neither a round nor a standing', async () => {
    const { event, rory } = await createField('null-strokes');
    const service = createGolfScoreService(getPrisma());

    await service.applyRoundScores(event.id, 1, [row(rory.participant.id, { strokes: null })]);

    expect(await getPrisma().sportEventParticipantRound.count({ where: { sportEventParticipantId: rory.sep.id } })).toBe(0);
    expect(await getPrisma().sportEventParticipantStanding.count({ where: { sportEventParticipantId: rory.sep.id } })).toBe(0);
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

    await createGolfScoreService(getPrisma()).updateRoundScore(event.id, 1, rory.sep.id, { strokes: 70, scoreToPar: -2 });

    const round = await getPrisma().sportEventParticipantRound.findFirstOrThrow({
      where: { sportEventParticipantId: rory.sep.id },
      include: { golf: true },
    });
    expect(round).toMatchObject({ status: 'COMPLETED', golf: { strokes: 70, scoreToPar: -2, thru: 18 } });
    const standing = await getPrisma().sportEventParticipantStanding.findUniqueOrThrow({
      where: { sportEventParticipantId: rory.sep.id },
      include: { golf: true },
    });
    expect(standing.golf).toMatchObject({ eventScoreToPar: -2, eventStrokes: 70 });
  });

  it('a PATCH correcting strokes and to par stores both as sent, and the standing and rank follow the corrected to par', async () => {
    const { event, rory, jordan } = await createField('patch-route');
    const service = createGolfScoreService(getPrisma());
    await service.applyRoundScores(event.id, 1, [
      row(rory.participant.id, { strokes: 68, scoreToPar: -4 }),
      row(jordan.participant.id, { strokes: 70, scoreToPar: -2 }),
    ]);
    const admin = await createTestUser({ isRootAdmin: true });

    const res = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}/rounds/1/golf-scores/${rory.sep.id}`,
      headers: admin.headers,
      payload: { strokes: 73, scoreToPar: 1, completedAt: '2026-05-07T22:15:00.000Z' },
    });

    expect(res.statusCode).toBe(200);
    const { participant } = res.json<SportEventParticipantResponse>();
    expect(participant.rounds).toEqual([
      expect.objectContaining({
        roundNumber: 1,
        status: 'COMPLETED',
        completedAt: '2026-05-07T22:15:00.000Z',
        golf: { strokes: 73, scoreToPar: 1, thru: 18 },
      }),
    ]);
    expect(participant.standing).toMatchObject({ position: 2, golf: { eventStrokes: 73, eventScoreToPar: 1 } });
    const jordanStanding = await getPrisma().sportEventParticipantStanding.findUniqueOrThrow({
      where: { sportEventParticipantId: jordan.sep.id },
    });
    expect(jordanStanding.position).toBe(1);
  });

  it('a PATCH with completedAt null clears the stored completion time', async () => {
    const { event, rory } = await createField('patch-clear');
    await createGolfScoreService(getPrisma()).applyRoundScores(event.id, 1, [
      row(rory.participant.id, { completedAt: '2026-05-07T22:15:00.000Z' }),
    ]);
    const admin = await createTestUser({ isRootAdmin: true });

    const res = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}/rounds/1/golf-scores/${rory.sep.id}`,
      headers: admin.headers,
      payload: { completedAt: null },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<SportEventParticipantResponse>().participant.rounds[0]).toMatchObject({ completedAt: null, status: 'COMPLETED' });
  });
});
