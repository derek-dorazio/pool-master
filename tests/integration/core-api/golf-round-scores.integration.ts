import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { expect } from '@jest/globals';
import { NO_CONTEST_ACTIVATION, testDomainEvents } from '../../support/domain-events';
import type { SportEventParticipantResponse } from '@poolmaster/shared/dto';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withBackgroundJobsFailing,
  integrationBackgroundJobs, integrationSportEventServices, integrationSyncFindings } from '../helpers';
import { PeriodUnit, Sport } from '@poolmaster/shared/domain';
import {
  GolfScoreError,
  type GolfScoreRowInput,
} from '../../../packages/core-api/src/modules/golf/golf-score-service';
import { createGolfScoreService } from '../../../packages/core-api/src/modules/events/wiring';
import { publishLiveScoreUpdate } from '../../../packages/core-api/src/modules/ingestion/core/score-publisher';
import { scoringFamilyForEvent } from '../../../packages/core-api/src/modules/scoring-families';
import { fixtureTourId, freshEventEdition, mapEventToProvider } from '../../support/event-edition';
import { eventRebuildJob } from '../../support/recording-leaderboard-rebuilds';
import { PrismaSportEventParticipantGolfStandingRepository } from '../../../packages/core-api/src/adapters';
import { sportRowKeys } from '../../support/sport-rows';
import { linkTestSlot, setEventSlotPeriods } from '../../support/test-slots';
import { oneEventSlotId } from '../../support/test-slots';

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
  await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF) },
    update: {},
  });
  const created = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      name: `Round Scores Open ${suffix}`,
      startDate: new Date('2026-05-07T12:00:00.000Z'),
      status: 'IN_PROGRESS',
    },
  });
  // The admin score correction writes only on a test event (#2074).
  await linkTestSlot(prisma, created);
  // A round of it is 18 holes, its slot's period count (#2047).
  await setEventSlotPeriods(prisma, created.id, { unit: PeriodUnit.HOLE, count: 18 });
  // The provider's id for the event, which a live-score sync names it by (#2004).
  const event = { ...created, externalId: `golf-round-scores-${created.id}` };
  await mapEventToProvider(prisma, event.id, { providerId: 'balldontlie', externalId: event.externalId });
  const round1 = await prisma.sportEventRound.create({
    data: { sportEventId: event.id, sportEventSlotId: await oneEventSlotId(prisma, event.id), roundNumber: 1, scheduledDate: new Date('2026-05-07T12:00:00.000Z') },
  });
  const golfers = await Promise.all(['Rory McIlroy', 'Jordan Spieth'].map(async (name) => {
    const participant = await prisma.participant.create({
      data: { sportLeagueId: await fixtureTourId(prisma), name, participantType: 'INDIVIDUAL' },
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
        status: 'COMPLETE',
        golf: { create: { eventScoreToPar: -3, eventStrokes: 69, currentRoundThru: 18 } },
      },
    });

    // #236 — the per-round score read is the field read now: every field row with its
    // rounds and standing, each carrying its golf extension.
    const views = await integrationSportEventServices().field.listEventParticipants(event.id);
    const byName = new Map(views.map((view) => [view.participant.name, view]));

    expect(byName.get('Jordan Spieth')).toMatchObject({ rounds: [], standing: null });
    expect(byName.get('Rory McIlroy')).toMatchObject({
      rounds: [expect.objectContaining({ round: expect.objectContaining({ roundNumber: 1, status: 'COMPLETED' }), golf: expect.objectContaining({ strokes: 69, scoreToPar: -3 }) })],
      standing: {
        standing: expect.objectContaining({ status: 'COMPLETE' }),
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
    const service = createGolfScoreService(getAppPrisma(), testDomainEvents());

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
    const service = createGolfScoreService(getAppPrisma(), testDomainEvents());

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
    const service = createGolfScoreService(getAppPrisma(), testDomainEvents());

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
      status: 'COMPLETE',
      golf: { eventScoreToPar: -4, eventStrokes: 68, currentRoundThru: 18 },
    });
  });

  it('skips a row with no strokes, as the sync path does, persisting neither a round nor a standing', async () => {
    const { event, rory } = await createField('null-strokes');
    const service = createGolfScoreService(getAppPrisma(), testDomainEvents());

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

    await createGolfScoreService(getAppPrisma(), testDomainEvents()).updateRoundScore(event.id, 1, rory.sep.id, { strokes: 70, scoreToPar: -2 });

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
    const service = createGolfScoreService(getAppPrisma(), testDomainEvents());
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
    await createGolfScoreService(getAppPrisma(), testDomainEvents()).applyRoundScores(event.id, 1, [
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

  it('a PATCH with thru null clears the stored thru, so the golfer no longer shows as mid-round', async () => {
    const { event, rory } = await createField('patch-clear-thru');
    await createGolfScoreService(getAppPrisma(), testDomainEvents()).applyRoundScores(event.id, 1, [
      row(rory.participant.id, { thru: 12, status: 'IN_PROGRESS' }),
    ]);
    const admin = await createTestUser({ isRootAdmin: true });

    const res = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}/rounds/1/golf-scores/${rory.sep.id}`,
      headers: admin.headers,
      payload: { thru: null },
    });

    expect(res.statusCode).toBe(200);
    const round = await getPrisma().sportEventParticipantRound.findFirstOrThrow({
      where: { sportEventParticipantId: rory.sep.id },
      include: { golf: true },
    });
    expect(round.golf).toMatchObject({ strokes: 68, thru: null });
  });

  it.each([
    ['0 strokes', { strokes: 0 }],
    ['negative strokes', { strokes: -1 }],
    ['a negative thru', { thru: -1 }],
  ])('a PATCH with %s is refused with 400 and leaves the stored round as it was', async (_label, payload) => {
    const { event, rory } = await createField(`patch-bounds-${Object.keys(payload)[0]}-${Object.values(payload)[0]}`);
    await createGolfScoreService(getAppPrisma(), testDomainEvents()).applyRoundScores(event.id, 1, [row(rory.participant.id)]);
    const admin = await createTestUser({ isRootAdmin: true });

    const res = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}/rounds/1/golf-scores/${rory.sep.id}`,
      headers: admin.headers,
      payload,
    });

    expect(res.statusCode).toBe(400);
    const round = await getPrisma().sportEventParticipantRound.findFirstOrThrow({
      where: { sportEventParticipantId: rory.sep.id },
      include: { golf: true },
    });
    expect(round.golf).toMatchObject({ strokes: 68, thru: 18 });
  });

  it.each([
    ['upload', '0 strokes', { strokes: 0 }, ''],
    ['upload', 'a negative thru', { thru: -1 }, ''],
    ['preview', '0 strokes', { strokes: 0 }, '/preview'],
    ['preview', 'a negative thru', { thru: -1 }, '/preview'],
  ])('%s: a row with %s is refused with 400 and writes nothing', async (operation, _label, overrides, suffix) => {
    const { event, rory } = await createField(`${operation}-bounds-${Object.keys(overrides)[0]}`);
    const admin = await createTestUser({ isRootAdmin: true });

    const res = await getApp().inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/rounds/1/golf-scores${suffix}`,
      headers: admin.headers,
      payload: { rows: [row(rory.participant.id, overrides)] },
    });

    expect(res.statusCode).toBe(400);
    expect(await getPrisma().sportEventParticipantRound.count({ where: { sportEventParticipantId: rory.sep.id } })).toBe(0);
  });
});

describe('Golf round scores — holes completed are bounded by the round\'s slot', () => {
  it('refuses a correction and an upload with more holes completed than the round\'s 18 with 422 ROUND_THRU_BEYOND_HOLES, leaving the stored round as it was', async () => {
    const { event, rory } = await createField('thru-beyond-holes');
    await createGolfScoreService(getAppPrisma(), testDomainEvents()).applyRoundScores(event.id, 1, [row(rory.participant.id)]);
    const admin = await createTestUser({ isRootAdmin: true });

    const patch = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}/rounds/1/golf-scores/${rory.sep.id}`,
      headers: admin.headers,
      payload: { thru: 19 },
    });
    const upload = await getApp().inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/rounds/1/golf-scores`,
      headers: admin.headers,
      payload: { rows: [row(rory.participant.id, { strokes: 66, thru: 19 })] },
    });

    expect([patch.statusCode, patch.json<{ error: { code: string } }>().error.code, upload.statusCode, upload.json<{ error: { code: string } }>().error.code]).toEqual([422, 'ROUND_THRU_BEYOND_HOLES', 422, 'ROUND_THRU_BEYOND_HOLES']);
    const round = await getPrisma().sportEventParticipantRound.findFirstOrThrow({
      where: { sportEventParticipantId: rory.sep.id },
      include: { golf: true },
    });
    expect(round.golf).toMatchObject({ strokes: 68, thru: 18 });
  });
});

// #375 — nothing is scored after the 18th hole of the event's last scheduled round: a playoff
// reported as a fifth round never becomes a round row or a score.
describe('Golf round scores — bounded by the event\'s scheduled rounds', () => {
  it('a score sync of a 4-round event skips round 5 and holes past 18, so the 72-hole score stands', async () => {
    const { event, rory, jordan } = await createField('beyond-schedule-sync');
    const prisma = getPrisma();
    await prisma.sportEvent.update({ where: { id: event.id }, data: { rounds: 4 } });
    const sportEventSlotId = await oneEventSlotId(prisma, event.id);
    await prisma.sportEventRound.createMany({
      data: [2, 3, 4].map((roundNumber) => ({ sportEventId: event.id, sportEventSlotId, roundNumber, scheduledDate: new Date('2026-05-07T12:00:00.000Z') })),
    });
    await prisma.participantProviderMapping.createMany({
      data: [
        { providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL', externalId: 'ext-rory', participantId: rory.participant.id, sportLeagueId: rory.participant.sportLeagueId },
        { providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL', externalId: 'ext-jordan', participantId: jordan.participant.id, sportLeagueId: jordan.participant.sportLeagueId },
      ],
    });
    const update = (participantExternalId: string, round: number, thru = 18) => ({
      participantExternalId, round, strokes: 70, scoreToPar: -2, thru, status: 'COMPLETED' as const,
    });

    const result = await publishLiveScoreUpdate({
      category: 'GOLF',
      externalEventId: event.externalId,
      rounds: [1, 2, 3, 4].map((round) => update('ext-rory', round)).concat(update('ext-rory', 5), update('ext-jordan', 1, 19)),
    }, { contestActivation: NO_CONTEST_ACTIVATION, prisma, providerId: 'balldontlie', domainEvents: testDomainEvents(), scoringFamilyForEvent, findings: integrationSyncFindings() });

    expect(result).toMatchObject({ updatesReturned: 6, updatesPersisted: 4, updatesSkipped: 2 });
    const roundNumbers = (await prisma.sportEventRound.findMany({ where: { sportEventId: event.id } })).map((round) => round.roundNumber).sort((left, right) => left - right);
    expect(roundNumbers).toEqual([1, 2, 3, 4]);
    expect(await prisma.sportEventParticipantRound.count({ where: { sportEventParticipantId: jordan.sep.id } })).toBe(0);
    const standing = await prisma.sportEventParticipantStanding.findUniqueOrThrow({
      where: { sportEventParticipantId: rory.sep.id },
      include: { golf: true },
    });
    expect(standing.golf?.eventScoreToPar).toBe(-8);
  });

  it('refuses an admin upload for round 5 of a 4-round event with 422 ROUND_BEYOND_SCHEDULE, creating no round', async () => {
    const { event, rory } = await createField('beyond-schedule-admin');
    await getPrisma().sportEvent.update({ where: { id: event.id }, data: { rounds: 4 } });
    const service = createGolfScoreService(getAppPrisma(), testDomainEvents());

    await expect(service.applyRoundScores(event.id, 5, [row(rory.participant.id)]))
      .rejects.toMatchObject({ code: 'ROUND_BEYOND_SCHEDULE', statusCode: 422 });
    expect(await getPrisma().sportEventRound.count({ where: { sportEventId: event.id, roundNumber: 5 } })).toBe(0);
  });

  it('refuses a thru-only correction for a golfer with no stored round with 422 ROUND_VALUES_REQUIRED, writing no round and no standing', async () => {
    const { event, rory } = await createField('thru-only-no-round');
    const service = createGolfScoreService(getAppPrisma(), testDomainEvents());

    await expect(service.updateRoundScore(event.id, 2, rory.sep.id, { thru: 9 }))
      .rejects.toMatchObject({ code: 'ROUND_VALUES_REQUIRED', statusCode: 422 });
    expect(await getPrisma().sportEventRound.count({ where: { sportEventId: event.id, roundNumber: 2 } })).toBe(0);
    expect(await getPrisma().sportEventParticipantRound.count({ where: { sportEventParticipantId: rory.sep.id } })).toBe(0);
    expect(await getPrisma().sportEventParticipantStanding.count({ where: { sportEventParticipantId: rory.sep.id } })).toBe(0);
  });
});

// #1164 — a live tick re-sends the whole field every few minutes, and most of it has not moved.
// Only the golfers whose scores changed are written; the rest keep their rows untouched.
describe('Golf round scores — a live sync writes only what changed', () => {
  it('a repeated tick leaves every round and standing row untouched, and a changed golfer\'s rows are rewritten while the rest are only re-ranked', async () => {
    const { event, rory, jordan } = await createField('unchanged-sync');
    const prisma = getPrisma();
    await prisma.sportEvent.update({ where: { id: event.id }, data: { rounds: 4 } });
    await prisma.participantProviderMapping.createMany({
      data: [
        { providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL', externalId: 'ext-rory', participantId: rory.participant.id, sportLeagueId: rory.participant.sportLeagueId },
        { providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL', externalId: 'ext-jordan', participantId: jordan.participant.id, sportLeagueId: jordan.participant.sportLeagueId },
      ],
    });
    const tick = (jordanToPar: number) => publishLiveScoreUpdate({
      category: 'GOLF',
      externalEventId: event.externalId,
      rounds: [
        { participantExternalId: 'ext-rory', round: 1, strokes: 33, scoreToPar: -3, thru: 9, status: 'IN_PROGRESS' as const },
        { participantExternalId: 'ext-jordan', round: 1, strokes: 36 + jordanToPar, scoreToPar: jordanToPar, thru: 9, status: 'IN_PROGRESS' as const },
      ],
    }, { contestActivation: NO_CONTEST_ACTIVATION, prisma, providerId: 'balldontlie', domainEvents: testDomainEvents(), scoringFamilyForEvent, findings: integrationSyncFindings() });
    const stamps = async (): Promise<Record<string, Array<string | undefined>>> => {
      const byEntry: Record<string, Array<string | undefined>> = {};
      for (const { sep } of [rory, jordan]) {
        const round = await prisma.sportEventParticipantRound.findFirstOrThrow({ where: { sportEventParticipantId: sep.id }, include: { golf: true } });
        const standing = await prisma.sportEventParticipantStanding.findUniqueOrThrow({ where: { sportEventParticipantId: sep.id }, include: { golf: true } });
        byEntry[sep.id] = [round.updatedAt, round.golf?.updatedAt, standing.updatedAt, standing.golf?.updatedAt].map((at) => at?.toISOString());
      }
      return byEntry;
    };

    await tick(1);
    const afterFirst = await stamps();
    const repeated = await tick(1);

    expect(repeated.writeDiagnostics.summary).toMatchObject({ unchanged: 4, created: 0, updated: 0 });
    expect(await stamps()).toEqual(afterFirst);

    await tick(-5);
    const afterChange = await stamps();

    // Rory's scores did not move, so only his rank (on the core standing, index 2) is rewritten.
    const [roundAt, golfRoundAt, , golfStandingAt] = afterFirst[rory.sep.id];
    expect(afterChange[rory.sep.id]).toEqual([roundAt, golfRoundAt, expect.any(String), golfStandingAt]);
    expect(afterChange[jordan.sep.id].every((at, index) => at !== afterFirst[jordan.sep.id][index])).toBe(true);
    const standings = await prisma.sportEventParticipantStanding.findMany({ where: { sportEventParticipantId: { in: [rory.sep.id, jordan.sep.id] } } });
    expect(Object.fromEntries(standings.map((standing) => [standing.sportEventParticipantId, standing.displayPosition]))).toEqual({
      [jordan.sep.id]: '1',
      [rory.sep.id]: '2',
    });
  });
});

describe('Golf standings ranks — the leaderboard rebuild they carry (#1466)', () => {
  const rebuildJobCount = (sportEventId: string) => getPrisma().backgroundJob.count({ where: { dedupeKey: eventRebuildJob(sportEventId).dedupeKey } });

  it('writes the rebuild job alone when no rank moved, and with the ranks when one did', async () => {
    const { event, round1, rory } = await createField('ranks-carry');
    await createGolfScoreService(getAppPrisma(), testDomainEvents()).applyRoundScores(event.id, round1.roundNumber, [row(rory.participant.id)]);
    const standings = new PrismaSportEventParticipantGolfStandingRepository(getAppPrisma());
    const [stored] = await standings.findBySportEvent(event.id);

    await standings.updateRanks([], [eventRebuildJob(event.id)]);
    await expect(rebuildJobCount(event.id)).resolves.toBe(1);

    await getPrisma().backgroundJob.deleteMany({ where: { dedupeKey: eventRebuildJob(event.id).dedupeKey } });
    await standings.updateRanks([{ standingId: stored.standing.id, position: 7, displayPosition: 'T7' }], [eventRebuildJob(event.id)]);
    await expect(rebuildJobCount(event.id)).resolves.toBe(1);
    await expect(getPrisma().sportEventParticipantStanding.findUniqueOrThrow({ where: { id: stored.standing.id } })).resolves.toMatchObject({ position: 7, displayPosition: 'T7' });
  });

  it('keeps the ranks as they were when the rebuild job cannot be written', async () => {
    const { event, round1, rory } = await createField('ranks-fail');
    await createGolfScoreService(getAppPrisma(), testDomainEvents()).applyRoundScores(event.id, round1.roundNumber, [row(rory.participant.id)]);
    const standings = new PrismaSportEventParticipantGolfStandingRepository(getAppPrisma());
    const [stored] = await standings.findBySportEvent(event.id);
    const jobsBefore = await rebuildJobCount(event.id);

    await expect(withBackgroundJobsFailing('REBUILD_LEADERBOARDS', () => standings.updateRanks(
      [{ standingId: stored.standing.id, position: 7, displayPosition: 'T7' }], [eventRebuildJob(event.id)],
    ))).rejects.toThrow();

    await expect(getPrisma().sportEventParticipantStanding.findUniqueOrThrow({ where: { id: stored.standing.id } }))
      .resolves.toMatchObject({ position: stored.standing.position, displayPosition: stored.standing.displayPosition ?? null });
    await expect(rebuildJobCount(event.id)).resolves.toBe(jobsBefore);
  });
});

describe('Golf round scores — a live tick\'s leaderboard rebuild (#1466)', () => {
  it('writes the event\'s rebuild job with the tick\'s last write, the ranks', async () => {
    const { event, rory } = await createField('live-rebuild');
    const prisma = getPrisma();
    await prisma.sportEvent.update({ where: { id: event.id }, data: { rounds: 4 } });
    await prisma.participantProviderMapping.create({ data: { providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL', externalId: 'ext-rory-live', participantId: rory.participant.id, sportLeagueId: rory.participant.sportLeagueId } });

    await publishLiveScoreUpdate({
      category: 'GOLF',
      externalEventId: event.externalId,
      rounds: [{ participantExternalId: 'ext-rory-live', round: 1, strokes: 33, scoreToPar: -3, thru: 9, status: 'IN_PROGRESS' as const }],
    }, { prisma: getAppPrisma(), providerId: 'balldontlie', domainEvents: testDomainEvents({ queue: integrationBackgroundJobs().queue }), contestActivation: NO_CONTEST_ACTIVATION, scoringFamilyForEvent, findings: integrationSyncFindings() });

    await expect(prisma.backgroundJob.count({ where: { dedupeKey: eventRebuildJob(event.id).dedupeKey } })).resolves.toBe(1);
  });
});
