import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  MatchEnding,
  MatchSideOutcome,
  MatchStatus,
  ParticipantStandingStatus,
  GameSideStatus,
  Sport,
  SportEventStatus,
  ValuationSource, SportEventParticipantStatus } from '@poolmaster/shared/domain';
import {
  PrismaParticipantRepository,
  PrismaSportEventRoundMatchRepository,
  PrismaFieldGameRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventSlotParticipantValuationRepository,
} from '../../../packages/core-api/src/adapters';
import type { FieldSideWrite, FieldStandingWrite } from '@poolmaster/shared/db';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { recordStatements, statementCounts, type RecordedStatement } from '../statement-log';
import { expectDefined } from '../../support/expect-defined';
import { freshEventEdition } from '../../support/event-edition';
import { participantLeagueId } from '../../support/participant-league';
import { sportRowKeys } from '../../support/sport-rows';
import { oneEventSlotId } from '../../support/test-slots';
import { AWAY_SIDE, HOME_SIDE } from '../../support/match-sides';
import { createMatchRow } from '../../support/match-rows';
import { inTierSet, tierSetSlot, type TierSetSlot } from '../../support/event-tier-sets';
import { standardPricingIn } from '../../support/budget-pricing';

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
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF) },
    update: {},
  });
  const edition = await freshEventEdition(prisma);
  const { sportLeagueId } = edition;
  const event = await prisma.sportEvent.create({
    data: {
      ...edition,
      name: `Batch Writes Open ${randomUUID().slice(0, 6)}`,
      startDate: new Date('2026-05-07T12:00:00.000Z'),
      status: SportEventStatus.DRAFT,
    },
  });
  const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId: await oneEventSlotId(prisma, event.id), roundNumber: 1, scheduledDate: new Date('2026-05-07') } });
  return { sport, sportLeagueId, event, round };
}

/** `count` new participants of the sport league, not on any field. */
async function participants(sportLeagueId: string, count: number) {
  const prisma = getPrisma();
  return Promise.all(Array.from({ length: count }, (_, index) => prisma.participant.create({
    data: { sportLeagueId, name: `Golfer ${index + 1} ${randomUUID().slice(0, 6)}`, participantType: 'INDIVIDUAL', status: 'ACTIVE' },
  })));
}

/** A golf event with a field of `size`, in participant creation order. */
async function eventWithField(size: number) {
  const prisma = getPrisma();
  const setup = await golfEvent();
  const golfers = await participants(setup.sportLeagueId, size);
  const field = [];
  for (const golfer of golfers) {
    field.push(await prisma.sportEventParticipant.create({ data: { sportEventId: setup.event.id, participantId: golfer.id } }));
  }
  return { ...setup, field, slot: await tierSetSlot(prisma, setup.event.id) };
}

/** A field row's valuation in the slot's set, or null when it has none. */
function valuationOf(slot: TierSetSlot, sportEventParticipantId: string) {
  return getPrisma().sportEventSlotParticipantValuation.findUnique({
    where: { sportEventSlotId_sportEventParticipantId: { sportEventSlotId: slot.id, sportEventParticipantId } },
  });
}

/**
 * Runs `test` on a small field and on a big one, answering for each how many statements the writes
 * it passes to `measure` sent to each table, as `statementCounts` gives them: its seeding and its
 * checks are not counted.
 */
async function queriesFor(test: (fieldSize: number, measure: <Result>(write: () => Promise<Result>) => Promise<Result>) => Promise<unknown>) {
  const counts = [];
  for (const fieldSize of [SMALL_FIELD, BIG_FIELD]) {
    const sent: RecordedStatement[] = [];
    await test(fieldSize, async (write) => {
      const { result, statements } = await recordStatements(write);
      sent.push(...statements);
      return result;
    });
    counts.push(statementCounts(sent));
  }
  return counts;
}

describe('Adding players to an event\'s field (#1252)', () => {
  it('adds any number of players in one insert', async () => {
    const counts = await queriesFor(async (size, measure) => {
      const { sportLeagueId, event } = await golfEvent();
      const golfers = await participants(sportLeagueId, size);
      await measure(() => new PrismaSportEventParticipantRepository(getAppPrisma()).createMany(event.id, golfers.map((golfer, index) => ({
        participantId: golfer.id,
        seedNumber: index + 1,
      }))));
      const field = await getPrisma().sportEventParticipant.findMany({ where: { sportEventId: event.id }, orderBy: { seedNumber: 'asc' } });
      expect(field.map((row) => [row.participantId, row.seedNumber])).toEqual(golfers.map((golfer, index) => [golfer.id, index + 1]));
    });

    const oneInsert = [['INSERT sport_event_participants', 1]];
    expect(counts).toEqual([oneInsert, oneInsert]);
  });
});

describe('Saving the field grid (#1252)', () => {
  it('refuses the whole save when one row it gives the same change does not exist, leaving the real row as it was', async () => {
    const { field, slot } = await eventWithField(1);
    const row = expectDefined(field[0]);
    const repository = new PrismaSportEventParticipantRepository(getAppPrisma());

    await expect(repository.updateMany([
      { id: row.id, updates: { ranking: 3 }, valuation: { slot, price: 12 } },
      { id: randomUUID(), updates: { ranking: 3 } },
    ])).rejects.toThrow('A field row to update does not exist.');

    const after = await getPrisma().sportEventParticipant.findUniqueOrThrow({ where: { id: row.id } });
    expect([after.ranking, await valuationOf(slot, row.id)]).toEqual([row.ranking, null]);
  });

  it('gives rows the same change in one update, and writes every manual price in a fixed number of queries', async () => {
    const counts = await queriesFor(async (size, measure) => {
      const { field, slot } = await eventWithField(size);
      await measure(() => new PrismaSportEventParticipantRepository(getAppPrisma()).updateMany(field.map((row) => ({
        id: row.id,
        updates: { status: SportEventParticipantStatus.WITHDRAWN },
        valuation: { slot, price: 1_000 },
      }))));
      const rows = await getPrisma().sportEventParticipant.findMany({ where: { id: { in: field.map((row) => row.id) } }, include: { valuations: true } });
      expect(rows.every((row) => row.status === SportEventParticipantStatus.WITHDRAWN)).toBe(true);
      expect(rows.map((row) => row.valuations.map((valuation) => [valuation.sportEventSlotId, Number(valuation.price), valuation.priceAssignedSource]))).toEqual(
        field.map(() => [[slot.id, 1_000, ValuationSource.MANUAL]]),
      );
    });

    expect(counts[1]).toEqual(counts[0]);
  });

  it('writes each row its own seed, and a price of null clears the price but keeps the row\'s tier', async () => {
    const { event, field, slot } = await eventWithField(SMALL_FIELD);
    const prisma = getPrisma();
    const [first, second] = field;
    const tier = await prisma.sportEventSlotTier.create({ data: { sportEventSlotId: slot.id, tierKey: 'A', tierNumber: 1 } });
    const before = await prisma.sportEventSlotParticipantValuation.create({
      data: { ...inTierSet(slot), sportEventParticipantId: expectDefined(first).id, sportEventSlotTierId: tier.id, tierOrderIndex: 0, tierAssignedSource: ValuationSource.MANUAL, price: 500, priceAssignedSource: ValuationSource.MANUAL },
    });

    await new PrismaSportEventParticipantRepository(prisma).updateMany([
      { id: expectDefined(first).id, updates: { seedNumber: 2 }, valuation: { slot, price: null } },
      { id: expectDefined(second).id, updates: { seedNumber: 1 } },
    ]);

    const rows = await prisma.sportEventParticipant.findMany({ where: { sportEventId: event.id }, orderBy: { seedNumber: 'asc' } });
    expect(rows.map((row) => row.id)).toEqual([expectDefined(second).id, expectDefined(first).id]);
    expect(await valuationOf(slot, expectDefined(first).id)).toMatchObject({ id: before.id, createdAt: before.createdAt, sportEventSlotTierId: tier.id, tierOrderIndex: 0, price: null });
    expect(await valuationOf(slot, expectDefined(second).id)).toBeNull();
  });
  it('writes a row\'s price and its move into another tier in the one save, both manual, and writes neither when another row is missing', async () => {
    const { field, slot } = await eventWithField(SMALL_FIELD);
    const prisma = getPrisma();
    const row = expectDefined(field[0]);
    const [tierA, tierB] = await Promise.all([
      prisma.sportEventSlotTier.create({ data: { sportEventSlotId: slot.id, tierKey: 'A', tierNumber: 1 } }),
      prisma.sportEventSlotTier.create({ data: { sportEventSlotId: slot.id, tierKey: 'B', tierNumber: 2 } }),
    ]);
    await prisma.sportEventSlotParticipantValuation.create({
      data: { ...inTierSet(slot), sportEventParticipantId: row.id, sportEventSlotTierId: tierA.id, tierOrderIndex: 0, tierAssignedSource: ValuationSource.AUTO_ODDS, price: 500, priceAssignedSource: ValuationSource.AUTO_ODDS },
    });
    const repository = new PrismaSportEventParticipantRepository(getAppPrisma());
    const valuation = { slot, price: 900, tier: { sportEventSlotTierId: tierB.id, tierOrderIndex: 4 } };

    await expect(repository.updateMany([
      { id: row.id, updates: { ranking: 3 }, valuation },
      { id: randomUUID(), updates: { ranking: 3 } },
    ])).rejects.toThrow('A field row to update does not exist.');
    const untouched = expectDefined(await valuationOf(slot, row.id));
    expect([untouched.sportEventSlotTierId, Number(untouched.price)]).toEqual([tierA.id, 500]);

    await repository.updateMany([{ id: row.id, updates: {}, valuation }]);

    const after = expectDefined(await valuationOf(slot, row.id));
    expect(after).toMatchObject({ sportEventSlotTierId: tierB.id, tierOrderIndex: 4, tierAssignedSource: ValuationSource.MANUAL, priceAssignedSource: ValuationSource.MANUAL });
    expect(Number(after.price)).toBe(900);
  });
});

describe('Assigning an event slot\'s tiers and prices (#1252, #2044)', () => {
  it('assigns every row a tier in a fixed number of queries, keeping a row\'s price, id and creation time', async () => {
    const counts = await queriesFor(async (size, measure) => {
      const { field, slot } = await eventWithField(size);
      const tier = await getPrisma().sportEventSlotTier.create({ data: { sportEventSlotId: slot.id, tierKey: 'A', tierNumber: 1 } });
      const priced = await getPrisma().sportEventSlotParticipantValuation.create({
        data: { ...inTierSet(slot), sportEventParticipantId: expectDefined(field[0]).id, price: 700, priceAssignedSource: ValuationSource.AUTO_ODDS },
      });

      await measure(() => new PrismaSportEventSlotParticipantValuationRepository(getAppPrisma()).assignTiers(slot, field.map((row, index) => ({
        sportEventParticipantId: row.id,
        sportEventSlotTierId: tier.id,
        tierOrderIndex: index,
        source: ValuationSource.AUTO_RANKING,
      }))));

      const valuations = await getPrisma().sportEventSlotParticipantValuation.findMany({ where: { sportEventSlotTierId: tier.id }, orderBy: { tierOrderIndex: 'asc' } });
      expect(valuations.map((row) => [row.sportEventParticipantId, row.tierOrderIndex])).toEqual(field.map((row, index) => [row.id, index]));
      expect(valuations[0]).toMatchObject({ id: priced.id, createdAt: priced.createdAt, priceAssignedSource: ValuationSource.AUTO_ODDS });
      expect(Number(valuations[0]?.price)).toBe(700);
    });

    expect(counts[1]).toEqual(counts[0]);
  });

  it('prices every row and saves the slot\'s pricing values in a fixed number of queries, keeping a row\'s tier', async () => {
    const counts = await queriesFor(async (size, measure) => {
      const { field, slot } = await eventWithField(size);
      const tier = await getPrisma().sportEventSlotTier.create({ data: { sportEventSlotId: slot.id, tierKey: 'A', tierNumber: 1 } });
      await getPrisma().sportEventSlotParticipantValuation.create({
        data: { ...inTierSet(slot), sportEventParticipantId: expectDefined(field[0]).id, sportEventSlotTierId: tier.id, tierOrderIndex: 3, tierAssignedSource: ValuationSource.MANUAL },
      });
      const pricing = await standardPricingIn(getPrisma());

      await measure(() => new PrismaSportEventSlotParticipantValuationRepository(getAppPrisma()).assignSlotPrices({
        slot,
        pricing,
        assignments: field.map((row, index) => ({ sportEventParticipantId: row.id, price: 10_000 - index * 100, source: ValuationSource.AUTO_ODDS })),
      }));

      const valuations = await getPrisma().sportEventSlotParticipantValuation.findMany({ where: { sportEventSlotId: slot.id } });
      const byId = new Map(valuations.map((row) => [row.sportEventParticipantId, row]));
      expect(field.map((row) => Number(byId.get(row.id)?.price))).toEqual(field.map((_, index) => 10_000 - index * 100));
      expect(byId.get(expectDefined(field[0]).id)).toMatchObject({ sportEventSlotTierId: tier.id, tierOrderIndex: 3, tierAssignedSource: ValuationSource.MANUAL });
      const saved = await getPrisma().sportEventSlot.findUniqueOrThrow({ where: { id: slot.id } });
      expect(saved).toMatchObject({
        platformPricingProfileId: pricing.platformPricingProfileId, salaryCap: pricing.salaryCap, pricingUnit: pricing.unit,
        topSharePercent: pricing.topSharePercent, floorSharePercent: pricing.floorSharePercent, steepness: pricing.steepness,
      });
    });

    expect(counts[1]).toEqual(counts[0]);
  });
});

describe('Uploading a sport league\'s rankings (#1252)', () => {
  it('ranks every player of the league in a fixed number of queries', async () => {
    const counts = await queriesFor(async (size, measure) => {
      const { sportLeagueId } = await golfEvent();
      const golfers = await participants(sportLeagueId, size);
      await getPrisma().participant.update({ where: { id: expectDefined(golfers[0]).id }, data: { ranking: 99 } });

      await measure(() => new PrismaParticipantRepository(getAppPrisma()).updateRankings(sportLeagueId, golfers.map((golfer, index) => ({
        participantId: golfer.id,
        ranking: index + 1,
      }))));

      const rows = await getPrisma().participant.findMany({
        where: { id: { in: golfers.map((golfer) => golfer.id) } },
        orderBy: { ranking: 'asc' },
      });
      expect(rows.map((row) => [row.id, row.ranking])).toEqual(golfers.map((golfer, index) => [golfer.id, index + 1]));
    });

    expect(counts[1]).toEqual(counts[0]);
  });

  it('refuses to rank a participant of another sport league, writing none of the rankings', async () => {
    const { sport, sportLeagueId } = await golfEvent();
    const [ranked] = await participants(sportLeagueId, 1);
    const [stranger] = await participants(await participantLeagueId(getPrisma(), sport.id), 1);
    await getPrisma().participant.update({ where: { id: expectDefined(ranked).id }, data: { ranking: 5 } });

    await expect(new PrismaParticipantRepository(getAppPrisma()).updateRankings(sportLeagueId, [
      { participantId: expectDefined(ranked).id, ranking: 1 },
      { participantId: expectDefined(stranger).id, ranking: 2 },
    ])).rejects.toThrow(`Only 1 of the 2 participants to rank are in sport league ${sportLeagueId}.`);

    const rows = await getPrisma().participant.findMany({ where: { id: { in: [expectDefined(ranked).id, expectDefined(stranger).id] } }, orderBy: { name: 'asc' } });
    const rankingById = new Map(rows.map((row) => [row.id, row.ranking]));
    expect([rankingById.get(expectDefined(ranked).id), rankingById.get(expectDefined(stranger).id)]).toEqual([5, null]);
  });
});

describe('Entering a race\'s finishing order (#1252)', () => {
  it('writes every runner\'s result and standing in a fixed number of queries, keeping a runner\'s side already in the race', async () => {
    const counts = await queriesFor(async (size, measure) => {
      const { event, field } = await eventWithField(size);
      const repo = new PrismaFieldGameRepository(getAppPrisma());
      const result = (row: { id: string }, index: number): FieldSideWrite => ({
        sportEventParticipantId: row.id, position: index + 1, startPosition: null, status: GameSideStatus.FINISHED, score: null, scoreToPar: null, periodsCompleted: null,
      });
      await repo.applyResults(event.id, { games: [{ roundNumber: 1, status: MatchStatus.IN_PROGRESS, completedAt: null, sides: [result(expectDefined(field[0]), 8)] }], standings: [] });
      const earlier = await getPrisma().sportEventRoundMatchSide.findFirstOrThrow({ where: { sportEventParticipantId: expectDefined(field[0]).id } });

      await measure(() => repo.applyResults(event.id, {
        games: [{ roundNumber: 1, status: MatchStatus.COMPLETED, completedAt: AS_OF, sides: field.map(result) }],
        standings: field.map((row, index) => ({ sportEventParticipantId: row.id, position: index + 1, displayPosition: `${index + 1}`, status: ParticipantStandingStatus.COMPLETE, asOf: AS_OF, total: null, scoreToPar: null })),
      }));

      const results = new Map((await repo.findResults(event.id)).map((row) => [row.sportEventParticipantId, row]));
      const standings = new Map((await getPrisma().sportEventParticipantStanding.findMany({ where: { sportEventParticipant: { sportEventId: event.id } } })).map((row) => [row.sportEventParticipantId, row]));
      expect(field.map((row) => [results.get(row.id)?.position, results.get(row.id)?.gameStatus, standings.get(row.id)?.position]))
        .toEqual(field.map((_, index) => [index + 1, MatchStatus.COMPLETED, index + 1]));
      await expect(getPrisma().sportEventRoundMatchSide.findFirstOrThrow({ where: { sportEventParticipantId: expectDefined(field[0]).id } }))
        .resolves.toMatchObject({ id: earlier.id, sideNumber: 1 });
    });

    expect(counts[1]).toEqual(counts[0]);
  });
});

describe('Entering a bracket match\'s result (#1252)', () => {
  it('writes every team\'s standing in a fixed number of queries, keeping a standing\'s id and the columns the write leaves alone', async () => {
    const counts = await queriesFor(async (size, measure) => {
      const { event, round, field } = await eventWithField(size);
      const [home, away] = field;
      const match = await createMatchRow(getPrisma(), {
        sportEventId: event.id,
        sportEventRoundId: round.id,
        sportEventSlotId: round.sportEventSlotId,
        matchNumber: 1,
        teams: [expectDefined(away).id, expectDefined(home).id],
        isNeutralSite: false,
      });
      const earlier = await getPrisma().sportEventParticipantStanding.create({
        data: { sportEventParticipantId: expectDefined(home).id, position: 4, status: ParticipantStandingStatus.ACTIVE },
      });

      await measure(() => new PrismaSportEventRoundMatchRepository(getAppPrisma()).applyResult({
        result: {
          id: match.id,
          status: MatchStatus.COMPLETED,
          ending: MatchEnding.PLAYED,
          completedAt: AS_OF,
          outcomes: [{ sideNumber: AWAY_SIDE, outcome: MatchSideOutcome.LOST }, { sideNumber: HOME_SIDE, outcome: MatchSideOutcome.WON }],
          gameOne: null,
        },
        sideFill: null,
        standings: field.map((row, index) => ({ sportEventParticipantId: row.id, position: index + 1, displayPosition: `${index + 1}`, status: ParticipantStandingStatus.ACTIVE, asOf: AS_OF })),
      }));

      const standings = await getPrisma().sportEventParticipantStanding.findMany({ where: { sportEventParticipantId: { in: field.map((row) => row.id) } } });
      const byId = new Map(standings.map((row) => [row.sportEventParticipantId, row]));
      expect(field.map((row) => byId.get(row.id)?.position)).toEqual(field.map((_, index) => index + 1));
      expect(byId.get(expectDefined(home).id)).toMatchObject({ id: earlier.id, createdAt: earlier.createdAt, asOf: AS_OF });
      const sides = await getPrisma().sportEventRoundMatchSide.findMany({ where: { sportEventRoundMatchId: match.id }, orderBy: { sideNumber: 'asc' } });
      expect(sides.map((side) => side.outcome)).toEqual([MatchSideOutcome.LOST, MatchSideOutcome.WON]);
    });

    expect(counts[1]).toEqual(counts[0]);
  });
});

describe('Entering a golf round\'s scores (#1252, #2008)', () => {
  /** A golfer's round as the stroke-play writer sends it. */
  const golferSide = (sportEventParticipantId: string, strokes: number): FieldSideWrite => ({
    sportEventParticipantId, score: strokes, scoreToPar: strokes - 72, periodsCompleted: 18, position: null, startPosition: null, status: GameSideStatus.FINISHED,
  });
  const golferStanding = (sportEventParticipantId: string, index: number): FieldStandingWrite => ({
    sportEventParticipantId, position: index + 1, displayPosition: `T${index + 1}`, status: ParticipantStandingStatus.ACTIVE, asOf: AS_OF, total: 70 + index, scoreToPar: index - 2,
  });

  it('writes every golfer\'s round and standing in a fixed number of queries, keeping a scored golfer\'s side, and the standing\'s id', async () => {
    const counts = await queriesFor(async (size, measure) => {
      const { event, field } = await eventWithField(size);
      const repo = new PrismaFieldGameRepository(getAppPrisma());
      const first = expectDefined(field[0]);
      await repo.applyResults(event.id, {
        games: [{ roundNumber: 1, status: MatchStatus.IN_PROGRESS, completedAt: null, sides: [{ ...golferSide(first.id, 30), periodsCompleted: 9, status: null }] }],
        standings: [golferStanding(first.id, 0)],
      });
      const earlierSide = await getPrisma().sportEventRoundMatchSide.findFirstOrThrow({ where: { sportEventParticipantId: first.id } });
      const [earlierStanding] = await repo.findStandings(event.id);

      await measure(() => repo.applyResults(event.id, {
        games: [{ roundNumber: 1, status: MatchStatus.COMPLETED, completedAt: AS_OF, sides: field.map((row, index) => golferSide(row.id, 70 + index)) }],
        standings: field.map((row, index) => golferStanding(row.id, index)),
      }));

      const results = new Map((await repo.findResults(event.id)).map((row) => [row.sportEventParticipantId, row]));
      expect(field.map((row) => [results.get(row.id)?.score, results.get(row.id)?.status])).toEqual(field.map((_, index) => [70 + index, GameSideStatus.FINISHED]));
      await expect(getPrisma().sportEventRoundMatchSide.findFirstOrThrow({ where: { sportEventParticipantId: first.id } })).resolves.toMatchObject({ id: earlierSide.id });
      const standings = new Map((await repo.findStandings(event.id)).map((row) => [row.sportEventParticipantId, row]));
      expect(standings.get(first.id)).toMatchObject({ id: expectDefined(earlierStanding).id, total: 70, displayPosition: 'T1' });
      expect(field.map((row) => standings.get(row.id)?.position)).toEqual(field.map((_, index) => index + 1));
    });

    expect(counts[1]).toEqual(counts[0]);
  });

  it('writes a 150-golfer, four-round event in as many queries as a two-golfer one: two status writes a round, the rest fixed', async () => {
    const counts = [];
    for (const fieldSize of [SMALL_FIELD, 150]) {
      const { event, field } = await eventWithField(fieldSize);
      const prisma = getPrisma();
      const sportEventSlotId = await oneEventSlotId(prisma, event.id);
      await prisma.sportEventRound.createMany({
        data: [2, 3, 4].map((roundNumber) => ({ sportEventId: event.id, sportEventSlotId, roundNumber, scheduledDate: new Date(Date.UTC(2026, 4, 6 + roundNumber)) })),
      });
      const { statements } = await recordStatements(() => new PrismaFieldGameRepository(getAppPrisma()).applyResults(event.id, {
        games: [1, 2, 3, 4].map((roundNumber) => ({ roundNumber, status: MatchStatus.COMPLETED, completedAt: AS_OF, sides: field.map((row, index) => golferSide(row.id, 70 + index)) })),
        standings: field.map((row, index) => golferStanding(row.id, index)),
      }));
      await expect(getPrisma().sportEventRoundMatchGameSideResult.count({ where: { game: { sportEventId: event.id } } })).resolves.toBe(fieldSize * 4);
      counts.push(statementCounts(statements));
    }

    expect(counts[1]).toEqual(counts[0]);
    // Each round's FIELD match and Game status, the only statements that grow, and with the rounds.
    expect(counts[0]).toEqual(expect.arrayContaining([['UPDATE sport_event_round_match_games', 4], ['UPDATE sport_event_round_matches', 4]]));
  });

  it('leaves alone the scored rounds a write does not name, when it names different rounds for different golfers', async () => {
    const prisma = getPrisma();
    const { event, field } = await eventWithField(2);
    const [golferA, golferB] = [expectDefined(field[0]), expectDefined(field[1])];
    await prisma.sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId: await oneEventSlotId(prisma, event.id), roundNumber: 2, scheduledDate: new Date('2026-05-08') } });
    const repo = new PrismaFieldGameRepository(prisma);
    await repo.applyResults(event.id, {
      games: [1, 2].map((roundNumber) => ({ roundNumber, status: MatchStatus.COMPLETED, completedAt: AS_OF, sides: [golferA, golferB].map((golfer) => golferSide(golfer.id, 69 + roundNumber)) })),
      standings: [],
    });

    await repo.applyResults(event.id, {
      games: [
        { roundNumber: 2, status: MatchStatus.COMPLETED, completedAt: AS_OF, sides: [golferSide(golferA.id, 68)] },
        { roundNumber: 1, status: MatchStatus.COMPLETED, completedAt: AS_OF, sides: [golferSide(golferB.id, 69)] },
      ],
      standings: [],
    });

    const results = await repo.findResults(event.id);
    const strokesOf = (golferId: string, roundNumber: number) => results
      .find((row) => row.sportEventParticipantId === golferId && row.roundNumber === roundNumber)?.score ?? null;
    expect([strokesOf(golferA.id, 1), strokesOf(golferA.id, 2), strokesOf(golferB.id, 1), strokesOf(golferB.id, 2)]).toEqual([70, 68, 69, 71]);
  });
});
