import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Sport, SportEventStatus } from '@poolmaster/shared/domain';
import type { SportEventParticipantListResponse, SportEventParticipantResponse } from '@poolmaster/shared/dto';
import { createSportEventParticipantService } from '../../../packages/core-api/src/modules/events/wiring';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { freshEventEdition } from '../../support/event-edition';
import { passReadCacheTtl, restoreReadCacheClock } from '../../support/read-cache-clock';

// An event's field against real Postgres (#1163): read in one repository call on one connection,
// shared by every contest and pick screen on the event for 30 seconds, and read afresh once an
// admin write to the event answers. A write to one field row answers with that row alone.
// No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());
afterEach(() => restoreReadCacheClock());

/** The Prisma client with every model operation counted, as `Model.operation`, and the rows each read returned. */
function countingPrisma() {
  const counts = new Map<string, number>();
  const rows = new Map<string, number>();
  const client = getPrisma().$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const key = `${model}.${operation}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
          const result = await query(args);
          if (Array.isArray(result)) rows.set(key, (rows.get(key) ?? 0) + result.length);
          else if (result) rows.set(key, (rows.get(key) ?? 0) + 1);
          return result;
        },
      },
    },
  });
  // The extended client runs every query the plain one does; the services take the plain type.
  return {
    prisma: client as unknown as PrismaClient,
    count: (key: string) => counts.get(key) ?? 0,
    rows: (key: string) => rows.get(key) ?? 0,
    operations: () => [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  };
}

/**
 * A golf event two rounds in, with a field of three: Ana (seed 1), Bea (seed 2) and Cal
 * (unseeded). Ana and Bea are affiliated with the event's tour, Cal is invited from elsewhere.
 * Ana is priced and has played both rounds, entered here second round first, and stands first.
 */
async function golfEvent() {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const edition = await freshEventEdition(prisma);
  const { sportLeagueId } = await prisma.eventSeries.findUniqueOrThrow({ where: { id: edition.eventSeriesId } });
  const event = await prisma.sportEvent.create({
    data: {
      ...edition,
      externalId: `field-reads-${randomUUID()}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Field Reads Open ${randomUUID().slice(0, 6)}`,
      startDate: new Date('2026-05-07T12:00:00.000Z'),
      status: SportEventStatus.DRAFT,
    },
  });
  const [round2, round1] = [
    await prisma.sportEventRound.create({ data: { sportEventId: event.id, roundNumber: 2, scheduledDate: new Date('2026-05-08') } }),
    await prisma.sportEventRound.create({ data: { sportEventId: event.id, roundNumber: 1, scheduledDate: new Date('2026-05-07') } }),
  ];
  const golfer = async (name: string, seedNumber: number | null, affiliated: boolean) => {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name: `${name} ${randomUUID().slice(0, 6)}`, participantType: 'INDIVIDUAL', status: 'ACTIVE' },
    });
    if (affiliated) await prisma.participantLeagueAffiliation.create({ data: { participantId: participant.id, sportLeagueId } });
    return prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id, seedNumber, ranking: 10 } });
  };
  const cal = await golfer('Cal', null, false);
  const bea = await golfer('Bea', 2, true);
  const ana = await golfer('Ana', 1, true);
  await prisma.sportEventParticipantValuation.create({ data: { sportEventParticipantId: ana.id, price: 12, priceAssignedSource: 'MANUAL' } });
  for (const [round, strokes] of [[round2, 70], [round1, 68]] as const) {
    await prisma.sportEventParticipantRound.create({
      data: { sportEventParticipantId: ana.id, sportEventRoundId: round.id, status: 'COMPLETED', golf: { create: { strokes, scoreToPar: strokes - 72 } } },
    });
  }
  await prisma.sportEventParticipantStanding.create({
    data: {
      sportEventParticipantId: ana.id,
      position: 1,
      currentRound: 2,
      status: 'ACTIVE',
      golf: { create: { eventScoreToPar: -6, eventStrokes: 138, currentRoundThru: 18 } },
    },
  });
  return { event, ana, bea, cal };
}

describe('An event\'s field', () => {
  it('is read in one call on the field table, each row with its participant, affiliation, price, standing and rounds in round order, seeded first', async () => {
    const { event, ana, bea, cal } = await golfEvent();
    const counting = countingPrisma();

    const field = await createSportEventParticipantService(counting.prisma).listEventParticipants(event.id);

    // The event's own row, then the field with every relation in one call: no read per table.
    expect(counting.operations()).toEqual([['SportEvent.findUnique', 1], ['SportEventParticipant.findMany', 1]]);
    expect(field.map((row) => [row.entry.id, row.affiliatedWithSportLeague])).toEqual([[ana.id, true], [bea.id, true], [cal.id, false]]);
    const [anaRow, beaRow] = field;
    expect(anaRow.valuation).toMatchObject({ price: 12 });
    expect(anaRow.standing).toMatchObject({ standing: { position: 1 }, golf: { eventScoreToPar: -6, eventStrokes: 138 } });
    expect(anaRow.rounds.map(({ round, golf, statLines }) => [round.roundNumber, golf?.strokes, statLines])).toEqual([[1, 68, []], [2, 70, []]]);
    expect(anaRow.raceResult).toBeNull();
    expect(anaRow.matches).toEqual([]);
    expect(beaRow).toMatchObject({ valuation: null, standing: null, rounds: [] });
  });

  it('is read once for every contest and pick screen on the event within 30 seconds, and again after', async () => {
    const { event } = await golfEvent();
    const counting = countingPrisma();
    const contestReads = createSportEventParticipantService(counting.prisma);
    const pickScreenReads = createSportEventParticipantService(counting.prisma);

    await contestReads.listCachedEventParticipants(event.id);
    await pickScreenReads.listCachedEventParticipants(event.id);
    const sharedReads = counting.count('SportEventParticipant.findMany');
    passReadCacheTtl();
    await pickScreenReads.listCachedEventParticipants(event.id);

    expect(sharedReads).toBe(1);
    expect(counting.count('SportEventParticipant.findMany')).toBe(2);
  });

  it('is read afresh as soon as an admin write to the event answers, so the next poll shows the change', async () => {
    const { event, bea } = await golfEvent();
    const admin = await createTestUser({ isRootAdmin: true });
    const readField = async () => (await getApp().inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/participants`,
      headers: admin.headers,
    })).json<SportEventParticipantListResponse>().participants;

    await readField();
    const saved = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}/participants`,
      headers: admin.headers,
      payload: { participants: [{ sportEventParticipantId: bea.id, ranking: 3 }] },
    });
    const polled = await readField();

    expect(saved.statusCode).toBe(200);
    expect(polled.find((row) => row.id === bea.id)?.ranking).toBe(3);
  });
});

describe('A write to one field row', () => {
  it('reads that row alone to answer, with the values the whole field read gives it', async () => {
    const { event, ana } = await golfEvent();
    const counting = countingPrisma();
    const service = createSportEventParticipantService(counting.prisma);

    const row = await service.getEventParticipant(event.id, ana.id);

    expect(counting.rows('SportEventParticipant.findFirst')).toBe(1);
    expect(counting.count('SportEventParticipant.findMany')).toBe(0);
    const [fromField] = await createSportEventParticipantService(getPrisma()).listEventParticipants(event.id);
    expect(row).toEqual(fromField);
  });

  it('answers a golf score correction with the corrected golfer alone', async () => {
    const { event, ana } = await golfEvent();
    const admin = await createTestUser({ isRootAdmin: true });

    const res = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}/rounds/1/golf-scores/${ana.id}`,
      headers: admin.headers,
      payload: { strokes: 67, scoreToPar: -5 },
    });

    expect(res.statusCode).toBe(200);
    const { participant } = res.json<SportEventParticipantResponse>();
    expect(participant.id).toBe(ana.id);
    expect(participant.rounds.map((round) => [round.roundNumber, round.golf?.strokes])).toEqual([[1, 67], [2, 70]]);
  });
});
