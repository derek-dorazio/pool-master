import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Sport, SportEventStatus } from '@poolmaster/shared/domain';
import type { SportEventParticipantListResponse, SportEventParticipantResponse } from '@poolmaster/shared/dto';
import {
  PrismaSportEventMatchRepository,
  PrismaSportEventParticipantRaceResultRepository,
} from '../../../packages/core-api/src/adapters';
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

/** A draft event of `sport` on a fixture tour of its own, with a field of `names`, each a new participant of the sport. */
async function eventWithField(sport: Sport, names: readonly string[]) {
  const prisma = getPrisma();
  const sportRow = await prisma.sport.findUniqueOrThrow({ where: { sport } });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `field-reads-${randomUUID()}`,
      providerId: 'integration-test',
      sport,
      name: `Field Reads ${sport} ${randomUUID().slice(0, 6)}`,
      startDate: new Date('2026-05-07T12:00:00.000Z'),
      status: SportEventStatus.DRAFT,
    },
  });
  const field = [];
  for (const name of names) {
    const participant = await prisma.participant.create({
      data: { sportId: sportRow.id, name: `${name} ${randomUUID().slice(0, 6)}`, participantType: 'TEAM', status: 'ACTIVE' },
    });
    field.push(await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id } }));
  }
  return { event, field };
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

  it('is read afresh once a participant on it is renamed, or the event\'s sport league affiliates another, so the next poll shows it', async () => {
    const { event, ana, cal } = await golfEvent();
    const { sportLeagueId } = await getPrisma().eventSeries.findUniqueOrThrow({ where: { id: event.eventSeriesId } });
    const admin = await createTestUser({ isRootAdmin: true });
    const readField = async () => (await getApp().inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/participants`,
      headers: admin.headers,
    })).json<SportEventParticipantListResponse>().participants;

    await readField();
    const renamed = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/participants/${ana.participantId}`,
      headers: admin.headers,
      payload: { name: 'Ana Renamed' },
    });
    const afterRename = await readField();
    const affiliated = await getApp().inject({
      method: 'POST',
      url: `/api/v1/sport-leagues/${sportLeagueId}/affiliations`,
      headers: admin.headers,
      payload: { participantId: cal.participantId },
    });
    const afterAffiliation = await readField();

    expect([renamed.statusCode, affiliated.statusCode]).toEqual([200, 201]);
    expect(afterRename.find((row) => row.id === ana.id)?.participant.name).toBe('Ana Renamed');
    expect(afterAffiliation.find((row) => row.id === cal.id)?.affiliatedWithSportLeague).toBe(true);
  });
});

// The relations of the families golf leaves empty, against real Postgres: what the field read
// gives each row is what the per-table reads it replaced gave (#1163).
describe('An event\'s field, for every scoring family', () => {
  it('gives each team the bracket matches naming it on either side, in match order, as the event\'s match read gives them', async () => {
    const prisma = getPrisma();
    const { event, field: [duke, unc, kansas, baylor] } = await eventWithField(Sport.BASKETBALL, ['Duke', 'UNC', 'Kansas', 'Baylor']);
    const [round1, round2] = await Promise.all([1, 2].map((roundNumber) => prisma.sportEventRound.create({
      data: { sportEventId: event.id, roundNumber, scheduledDate: new Date(`2026-03-${19 + roundNumber}`) },
    })));
    // Duke is away in match 1 and home in match 2; written match 2 first.
    const match2 = await prisma.sportEventMatch.create({
      data: { sportEventId: event.id, sportEventRoundId: round2.id, matchNumber: 2, homeSportEventParticipantId: duke.id, isNeutralSite: true },
    });
    const match1 = await prisma.sportEventMatch.create({
      data: {
        sportEventId: event.id,
        sportEventRoundId: round1.id,
        matchNumber: 1,
        homeSportEventParticipantId: unc.id,
        awaySportEventParticipantId: duke.id,
        isNeutralSite: true,
        status: 'COMPLETED',
        winnerSide: 'AWAY',
        homeScore: 70,
        awayScore: 75,
        homeSpread: '-3.5',
        advancesToMatchId: match2.id,
        advancesToSide: 'HOME',
      },
    });
    for (const [periodNumber, homeScore, awayScore] of [[2, 40, 37], [1, 30, 38]]) {
      await prisma.sportEventMatchPeriodScore.create({ data: { sportEventMatchId: match1.id, periodNumber, homeScore, awayScore } });
    }
    await prisma.sportEventMatch.create({
      data: { sportEventId: event.id, sportEventRoundId: round1.id, matchNumber: 3, homeSportEventParticipantId: kansas.id, awaySportEventParticipantId: baylor.id, isNeutralSite: true },
    });

    const rows = await createSportEventParticipantService(prisma).listEventParticipants(event.id);
    const matches = await new PrismaSportEventMatchRepository(prisma).findBySportEvent(event.id);

    const dukeRow = rows.find((row) => row.entry.id === duke.id);
    expect(dukeRow?.matches.map((match) => [match.matchNumber, match.roundNumber])).toEqual([[1, 1], [2, 2]]);
    expect(dukeRow?.matches[0]).toMatchObject({ homeSpread: -3.5, periodScores: [
      { periodNumber: 1, homeScore: 30, awayScore: 38 },
      { periodNumber: 2, homeScore: 40, awayScore: 37 },
    ] });
    for (const row of rows) {
      expect(row.matches).toEqual(matches.filter((match) => (
        match.homeSportEventParticipantId === row.entry.id || match.awaySportEventParticipantId === row.entry.id
      )));
    }
  });

  it('gives a runner its race result once one is entered, and none to a runner without one, as the event\'s race result read gives them', async () => {
    const prisma = getPrisma();
    const { event, field: [winner, scratched, unplaced] } = await eventWithField(Sport.HORSE_RACING, ['Secretariat', 'Sham', 'Twice A Prince']);
    await prisma.sportEventParticipantRaceResult.create({
      data: { sportEventParticipantId: winner.id, finishPosition: 1, startPosition: 2, resultStatus: 'FINISHED', isOfficial: true, riderName: 'Ron Turcotte' },
    });
    await prisma.sportEventParticipantRaceResult.create({
      data: { sportEventParticipantId: scratched.id, resultStatus: 'DID_NOT_START' },
    });

    const rows = await createSportEventParticipantService(prisma).listEventParticipants(event.id);
    const results = await new PrismaSportEventParticipantRaceResultRepository(prisma).findBySportEvent(event.id);

    const byRow = new Map(rows.map((row) => [row.entry.id, row.raceResult]));
    expect(byRow.get(winner.id)).toMatchObject({ finishPosition: 1, startPosition: 2, resultStatus: 'FINISHED', isOfficial: true, riderName: 'Ron Turcotte' });
    expect(byRow.get(scratched.id)).toMatchObject({ finishPosition: null, resultStatus: 'DID_NOT_START', isOfficial: false });
    expect(byRow.get(unplaced.id)).toBeNull();
    for (const row of rows) {
      expect(row.raceResult).toEqual(results.find((result) => result.sportEventParticipantId === row.entry.id) ?? null);
    }
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
