import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  MatchEnding,
  MatchSide,
  MatchStatus,
  ParticipantRoundStatus,
  ParticipantStandingStatus,
  RaceResultStatus,
  Sport,
  SportEventStatus,
  ValuationSource,
} from '@poolmaster/shared/domain';
import {
  PrismaParticipantLeagueAffiliationRepository,
  PrismaSportEventMatchRepository,
  PrismaSportEventParticipantGolfRoundRepository,
  PrismaSportEventParticipantGolfStandingRepository,
  PrismaSportEventParticipantRaceResultRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventParticipantValuationRepository,
} from '../../../packages/core-api/src/adapters';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { countingPrisma } from '../../support/counting-prisma';
import { expectDefined } from '../../support/expect-defined';
import { freshEventEdition } from '../../support/event-edition';

// The root-admin event tools' batch writes against real Postgres (#1252): each writes a whole
// field in a fixed number of queries, however big the field, and leaves the rows as the
// one-row-at-a-time writes did, ids and untouched columns kept. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const SMALL_FIELD = 2;
const BIG_FIELD = 6;
const AS_OF = new Date('2026-05-08T20:00:00.000Z');

/** A draft golf event with one round and no field, on a series of its own. */
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
      externalId: `batch-writes-${randomUUID()}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Batch Writes Open ${randomUUID().slice(0, 6)}`,
      startDate: new Date('2026-05-07T12:00:00.000Z'),
      status: SportEventStatus.DRAFT,
      rounds: 1,
    },
  });
  const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, roundNumber: 1, scheduledDate: new Date('2026-05-07') } });
  return { sport, sportLeagueId, event, round };
}

/** `count` new participants of the sport, not on any field. */
async function participants(sportId: string, count: number) {
  const prisma = getPrisma();
  return Promise.all(Array.from({ length: count }, (_, index) => prisma.participant.create({
    data: { sportId, name: `Golfer ${index + 1} ${randomUUID().slice(0, 6)}`, participantType: 'INDIVIDUAL', status: 'ACTIVE' },
  })));
}

/** A golf event with a field of `size`, in participant creation order. */
async function eventWithField(size: number) {
  const prisma = getPrisma();
  const setup = await golfEvent();
  const golfers = await participants(setup.sport.id, size);
  const field = [];
  for (const golfer of golfers) {
    field.push(await prisma.sportEventParticipant.create({ data: { sportEventId: setup.event.id, participantId: golfer.id } }));
  }
  return { ...setup, field };
}

/** Runs `write` on a small field and on a big one and answers how many queries each made. */
async function queriesFor(write: (prisma: ReturnType<typeof countingPrisma>['prisma'], fieldSize: number) => Promise<unknown>) {
  const counts = [];
  for (const fieldSize of [SMALL_FIELD, BIG_FIELD]) {
    const counted = countingPrisma(getAppPrisma());
    await write(counted.prisma, fieldSize);
    counts.push(counted.total());
  }
  return counts;
}

describe('Adding players to an event\'s field (#1252)', () => {
  it('adds any number of players in one insert', async () => {
    const counts = await queriesFor(async (prisma, size) => {
      const { sport, event } = await golfEvent();
      const golfers = await participants(sport.id, size);
      await new PrismaSportEventParticipantRepository(prisma).createMany(event.id, golfers.map((golfer, index) => ({
        participantId: golfer.id,
        seedNumber: index + 1,
      })));
      const field = await getPrisma().sportEventParticipant.findMany({ where: { sportEventId: event.id }, orderBy: { seedNumber: 'asc' } });
      expect(field.map((row) => [row.participantId, row.seedNumber])).toEqual(golfers.map((golfer, index) => [golfer.id, index + 1]));
    });

    expect(counts).toEqual([1, 1]);
  });
});

describe('Saving the field grid (#1252)', () => {
  it('refuses the whole save when one row it gives the same change does not exist, leaving the real row as it was', async () => {
    const { field } = await eventWithField(1);
    const row = expectDefined(field[0]);
    const repository = new PrismaSportEventParticipantRepository(getAppPrisma());

    await expect(repository.updateMany([
      { id: row.id, updates: { ranking: 3 }, price: 12 },
      { id: randomUUID(), updates: { ranking: 3 } },
    ])).rejects.toThrow('A field row to update does not exist.');

    const after = await getPrisma().sportEventParticipant.findUniqueOrThrow({ where: { id: row.id }, include: { valuation: true } });
    expect([after.ranking, after.valuation]).toEqual([row.ranking, null]);
  });

  it('gives rows the same change in one update, and writes every manual price in a fixed number of queries', async () => {
    const counts = await queriesFor(async (prisma, size) => {
      const { field } = await eventWithField(size);
      await new PrismaSportEventParticipantRepository(prisma).updateMany(field.map((row) => ({
        id: row.id,
        updates: { isActive: false, inactiveReason: 'WITHDRAWN' },
        price: 1_000,
      })));
      const rows = await getPrisma().sportEventParticipant.findMany({ where: { id: { in: field.map((row) => row.id) } }, include: { valuation: true } });
      expect(rows.every((row) => !row.isActive && row.inactiveReason === 'WITHDRAWN')).toBe(true);
      expect(rows.map((row) => [Number(row.valuation?.price), row.valuation?.priceAssignedSource])).toEqual(
        field.map(() => [1_000, ValuationSource.MANUAL]),
      );
    });

    expect(counts[1]).toBe(counts[0]);
  });

  it('writes each row its own seed, and a price of null clears the price but keeps the row\'s tier', async () => {
    const { event, field } = await eventWithField(SMALL_FIELD);
    const prisma = getPrisma();
    const [first, second] = field;
    const tier = await prisma.sportEventTier.create({ data: { sportEventId: event.id, tierKey: 'A', label: 'Tier A', tierNumber: 1 } });
    const before = await prisma.sportEventParticipantValuation.create({
      data: { sportEventParticipantId: expectDefined(first).id, sportEventTierId: tier.id, tierOrderIndex: 0, tierAssignedSource: ValuationSource.MANUAL, price: 500, priceAssignedSource: ValuationSource.MANUAL },
    });

    await new PrismaSportEventParticipantRepository(prisma).updateMany([
      { id: expectDefined(first).id, updates: { seedNumber: 2 }, price: null },
      { id: expectDefined(second).id, updates: { seedNumber: 1 } },
    ]);

    const rows = await prisma.sportEventParticipant.findMany({ where: { sportEventId: event.id }, include: { valuation: true }, orderBy: { seedNumber: 'asc' } });
    expect(rows.map((row) => row.id)).toEqual([expectDefined(second).id, expectDefined(first).id]);
    expect(rows[1]?.valuation).toMatchObject({ id: before.id, createdAt: before.createdAt, sportEventTierId: tier.id, tierOrderIndex: 0, price: null });
    expect(rows[0]?.valuation).toBeNull();
  });
});

describe('Assigning an event\'s tiers and prices (#1252)', () => {
  it('assigns every row a tier in a fixed number of queries, keeping a row\'s price, id and creation time', async () => {
    const counts = await queriesFor(async (prisma, size) => {
      const { event, field } = await eventWithField(size);
      const tier = await getPrisma().sportEventTier.create({ data: { sportEventId: event.id, tierKey: 'A', label: 'Tier A', tierNumber: 1 } });
      const priced = await getPrisma().sportEventParticipantValuation.create({
        data: { sportEventParticipantId: expectDefined(field[0]).id, price: 700, priceAssignedSource: ValuationSource.AUTO_ODDS },
      });

      await new PrismaSportEventParticipantValuationRepository(prisma).assignTiers(field.map((row, index) => ({
        sportEventParticipantId: row.id,
        sportEventTierId: tier.id,
        tierOrderIndex: index,
        source: ValuationSource.AUTO_RANKING,
      })));

      const valuations = await getPrisma().sportEventParticipantValuation.findMany({ where: { sportEventTierId: tier.id }, orderBy: { tierOrderIndex: 'asc' } });
      expect(valuations.map((row) => [row.sportEventParticipantId, row.tierOrderIndex])).toEqual(field.map((row, index) => [row.id, index]));
      expect(valuations[0]).toMatchObject({ id: priced.id, createdAt: priced.createdAt, priceAssignedSource: ValuationSource.AUTO_ODDS });
      expect(Number(valuations[0]?.price)).toBe(700);
    });

    expect(counts[1]).toBe(counts[0]);
  });

  it('prices every row and saves the event\'s pricing values in a fixed number of queries, keeping a row\'s tier', async () => {
    const counts = await queriesFor(async (prisma, size) => {
      const { event, field } = await eventWithField(size);
      const tier = await getPrisma().sportEventTier.create({ data: { sportEventId: event.id, tierKey: 'A', label: 'Tier A', tierNumber: 1 } });
      await getPrisma().sportEventParticipantValuation.create({
        data: { sportEventParticipantId: expectDefined(field[0]).id, sportEventTierId: tier.id, tierOrderIndex: 3, tierAssignedSource: ValuationSource.MANUAL },
      });
      const pricingConfig = { profileName: 'Standard', salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };

      await new PrismaSportEventParticipantValuationRepository(prisma).assignEventPrices({
        sportEventId: event.id,
        pricingConfig,
        assignments: field.map((row, index) => ({ sportEventParticipantId: row.id, price: 10_000 - index * 100, source: ValuationSource.AUTO_ODDS })),
      });

      const rows = await getPrisma().sportEventParticipant.findMany({ where: { sportEventId: event.id }, include: { valuation: true } });
      const byId = new Map(rows.map((row) => [row.id, row.valuation]));
      expect(field.map((row) => Number(byId.get(row.id)?.price))).toEqual(field.map((_, index) => 10_000 - index * 100));
      expect(byId.get(expectDefined(field[0]).id)).toMatchObject({ sportEventTierId: tier.id, tierOrderIndex: 3, tierAssignedSource: ValuationSource.MANUAL });
      const saved = await getPrisma().sportEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(saved.pricingConfig).toEqual(pricingConfig);
    });

    expect(counts[1]).toBe(counts[0]);
  });
});

describe('Uploading a sport league\'s rankings (#1252)', () => {
  it('ranks every player in a fixed number of queries, adding missing affiliations and keeping existing ones\' ids', async () => {
    const counts = await queriesFor(async (prisma, size) => {
      const { sport, sportLeagueId } = await golfEvent();
      const golfers = await participants(sport.id, size);
      const existing = await getPrisma().participantLeagueAffiliation.create({
        data: { participantId: expectDefined(golfers[0]).id, sportLeagueId, ranking: 99 },
      });

      await new PrismaParticipantLeagueAffiliationRepository(prisma).upsertRankings(sportLeagueId, golfers.map((golfer, index) => ({
        participantId: golfer.id,
        ranking: index + 1,
      })));

      const rows = await getPrisma().participantLeagueAffiliation.findMany({
        where: { sportLeagueId, participantId: { in: golfers.map((golfer) => golfer.id) } },
        orderBy: { ranking: 'asc' },
      });
      expect(rows.map((row) => [row.participantId, row.ranking])).toEqual(golfers.map((golfer, index) => [golfer.id, index + 1]));
      expect(rows[0]).toMatchObject({ id: existing.id, createdAt: existing.createdAt });
    });

    expect(counts[1]).toBe(counts[0]);
  });

  it('refuses to re-rank a player with no affiliation, writing none of the rankings', async () => {
    const { sport, sportLeagueId } = await golfEvent();
    const [ranked, stranger] = await participants(sport.id, 2);
    await getPrisma().participantLeagueAffiliation.create({ data: { participantId: expectDefined(ranked).id, sportLeagueId, ranking: 5 } });

    await expect(new PrismaParticipantLeagueAffiliationRepository(getAppPrisma()).updateRankings(sportLeagueId, [
      { participantId: expectDefined(ranked).id, ranking: 1 },
      { participantId: expectDefined(stranger).id, ranking: 2 },
    ])).rejects.toThrow(expectDefined(stranger).id);

    const rows = await getPrisma().participantLeagueAffiliation.findMany({ where: { sportLeagueId, participantId: { in: [expectDefined(ranked).id, expectDefined(stranger).id] } } });
    expect(rows.map((row) => [row.participantId, row.ranking])).toEqual([[expectDefined(ranked).id, 5]]);
  });
});

describe('Entering a race\'s finishing order (#1252)', () => {
  it('writes every runner\'s result and standing in a fixed number of queries, keeping a result\'s id', async () => {
    const counts = await queriesFor(async (prisma, size) => {
      const { event, field } = await eventWithField(size);
      const earlier = await getPrisma().sportEventParticipantRaceResult.create({
        data: { sportEventParticipantId: expectDefined(field[0]).id, finishPosition: 9, resultStatus: RaceResultStatus.FINISHED },
      });

      await new PrismaSportEventParticipantRaceResultRepository(prisma).applyResults(event.id, {
        isOfficial: true,
        results: field.map((row, index) => ({ sportEventParticipantId: row.id, finishPosition: index + 1, startPosition: null, resultStatus: RaceResultStatus.FINISHED, riderName: null })),
        standings: field.map((row, index) => ({ sportEventParticipantId: row.id, position: index + 1, displayPosition: `${index + 1}`, status: ParticipantStandingStatus.COMPLETE, currentRound: 1, asOf: AS_OF })),
      });

      const rows = await getPrisma().sportEventParticipant.findMany({ where: { sportEventId: event.id }, include: { raceResult: true, standing: true } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(field.map((row) => [byId.get(row.id)?.raceResult?.finishPosition, byId.get(row.id)?.raceResult?.isOfficial, byId.get(row.id)?.standing?.position]))
        .toEqual(field.map((_, index) => [index + 1, true, index + 1]));
      expect(byId.get(expectDefined(field[0]).id)?.raceResult).toMatchObject({ id: earlier.id, createdAt: earlier.createdAt });
    });

    expect(counts[1]).toBe(counts[0]);
  });
});

describe('Entering a bracket match\'s result (#1252)', () => {
  it('writes every team\'s standing in a fixed number of queries, keeping a standing\'s id and the columns the write leaves alone', async () => {
    const counts = await queriesFor(async (prisma, size) => {
      const { event, round, field } = await eventWithField(size);
      const [home, away] = field;
      const match = await getPrisma().sportEventMatch.create({
        data: {
          sportEventId: event.id,
          sportEventRoundId: round.id,
          matchNumber: 1,
          homeSportEventParticipantId: expectDefined(home).id,
          awaySportEventParticipantId: expectDefined(away).id,
          isNeutralSite: false,
        },
      });
      const earlier = await getPrisma().sportEventParticipantStanding.create({
        data: { sportEventParticipantId: expectDefined(home).id, position: 4, status: ParticipantStandingStatus.ACTIVE },
      });

      await new PrismaSportEventMatchRepository(prisma).applyResult({
        result: { id: match.id, status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 70, awayScore: 60, homeShootoutScore: null, awayShootoutScore: null, ending: MatchEnding.PLAYED },
        sideFill: null,
        standings: field.map((row, index) => ({ sportEventParticipantId: row.id, position: index + 1, displayPosition: `${index + 1}`, status: ParticipantStandingStatus.ACTIVE, currentRound: 1, asOf: AS_OF })),
      });

      const standings = await getPrisma().sportEventParticipantStanding.findMany({ where: { sportEventParticipantId: { in: field.map((row) => row.id) } } });
      const byId = new Map(standings.map((row) => [row.sportEventParticipantId, row]));
      expect(field.map((row) => byId.get(row.id)?.position)).toEqual(field.map((_, index) => index + 1));
      expect(byId.get(expectDefined(home).id)).toMatchObject({ id: earlier.id, createdAt: earlier.createdAt, asOf: AS_OF });
      expect((await getPrisma().sportEventMatch.findUniqueOrThrow({ where: { id: match.id } })).winnerSide).toBe(MatchSide.HOME);
    });

    expect(counts[1]).toBe(counts[0]);
  });
});

describe('Entering a golf round\'s scores (#1252)', () => {
  it('writes every golfer\'s round in a fixed number of queries, creating missing rounds, keeping scored ones\' ids and answering them in the order given', async () => {
    const counts = await queriesFor(async (prisma, size) => {
      const { round, field } = await eventWithField(size);
      const scored = await getPrisma().sportEventParticipantRound.create({
        data: { sportEventParticipantId: expectDefined(field[0]).id, sportEventRoundId: round.id, status: 'IN_PROGRESS', golf: { create: { strokes: 30, scoreToPar: -2, thru: 9 } } },
        include: { golf: true },
      });

      const results = await new PrismaSportEventParticipantGolfRoundRepository(prisma).upsertMany(field.map((row, index) => ({
        sportEventParticipantId: row.id,
        sportEventRoundId: round.id,
        status: ParticipantRoundStatus.COMPLETED,
        completedAt: AS_OF,
        strokes: 70 + index,
        scoreToPar: index - 2,
        thru: 18,
      })));

      expect(results.map(({ participantRound, golf }) => [participantRound.sportEventParticipantId, participantRound.status, golf.strokes]))
        .toEqual(field.map((row, index) => [row.id, ParticipantRoundStatus.COMPLETED, 70 + index]));
      const first = expectDefined(results.find(({ participantRound }) => participantRound.sportEventParticipantId === expectDefined(field[0]).id));
      expect(first.participantRound.id).toBe(scored.id);
      expect(first.golf).toMatchObject({ id: expectDefined(scored.golf).id, createdAt: expectDefined(scored.golf).createdAt });
    });

    expect(counts[1]).toBe(counts[0]);
  });

  it('leaves alone the scored rounds a write does not name, when it names different rounds for different golfers', async () => {
    const prisma = getPrisma();
    const { event, round, field } = await eventWithField(2);
    const [golferA, golferB] = [expectDefined(field[0]), expectDefined(field[1])];
    const round2 = await prisma.sportEventRound.create({ data: { sportEventId: event.id, roundNumber: 2, scheduledDate: new Date('2026-05-08') } });
    for (const golfer of [golferA, golferB]) {
      for (const [scheduled, strokes] of [[round, 70], [round2, 71]] as const) {
        await prisma.sportEventParticipantRound.create({
          data: { sportEventParticipantId: golfer.id, sportEventRoundId: scheduled.id, status: 'COMPLETED', golf: { create: { strokes, scoreToPar: strokes - 72, thru: 18 } } },
        });
      }
    }

    await new PrismaSportEventParticipantGolfRoundRepository(prisma).upsertMany([
      { sportEventParticipantId: golferA.id, sportEventRoundId: round2.id, status: ParticipantRoundStatus.COMPLETED, completedAt: AS_OF, strokes: 68, scoreToPar: -4, thru: 18 },
      { sportEventParticipantId: golferB.id, sportEventRoundId: round.id, status: ParticipantRoundStatus.COMPLETED, completedAt: AS_OF, strokes: 69, scoreToPar: -3, thru: 18 },
    ]);

    const rounds = await prisma.sportEventParticipantRound.findMany({
      where: { sportEventParticipantId: { in: [golferA.id, golferB.id] } },
      include: { golf: true, sportEventRound: true },
    });
    const strokesOf = (golferId: string, roundNumber: number) => rounds
      .find((row) => row.sportEventParticipantId === golferId && row.sportEventRound.roundNumber === roundNumber)?.golf?.strokes ?? null;
    expect([strokesOf(golferA.id, 1), strokesOf(golferA.id, 2), strokesOf(golferB.id, 1), strokesOf(golferB.id, 2)]).toEqual([70, 68, 69, 71]);
  });

  it('writes every golfer\'s standing, answered in the order given, and then every rank in a fixed number of queries each, keeping the standing\'s id and totals', async () => {
    const counts = await queriesFor(async (prisma, size) => {
      const { field } = await eventWithField(size);
      const standings = new PrismaSportEventParticipantGolfStandingRepository(prisma);

      const written = await standings.upsertMany(field.map((row, index) => ({
        sportEventParticipantId: row.id,
        currentRound: 1,
        status: ParticipantStandingStatus.ACTIVE,
        asOf: AS_OF,
        eventScoreToPar: index - 2,
        eventStrokes: 70 + index,
        currentRoundThru: 18,
      })));
      await standings.updateRanks(written.map(({ standing }, index) => ({ standingId: standing.id, position: index + 1, displayPosition: `T${index + 1}` })));

      expect(written.map(({ standing }) => standing.sportEventParticipantId)).toEqual(field.map((row) => row.id));
      const afterById = new Map((await standings.findBySportEventParticipants(field.map((row) => row.id))).map((result) => [result.standing.id, result]));
      const after = written.map(({ standing }) => expectDefined(afterById.get(standing.id)));
      expect(after.map(({ standing, golf }) => [standing.id, standing.position, standing.displayPosition, golf.id, golf.eventStrokes, standing.asOf]))
        .toEqual(written.map(({ standing, golf }, index) => [standing.id, index + 1, `T${index + 1}`, golf.id, golf.eventStrokes, AS_OF]));
    });

    expect(counts[1]).toBe(counts[0]);
  });
});
