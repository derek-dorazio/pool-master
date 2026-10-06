import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Sport } from '@poolmaster/shared/domain';
import {
  PrismaEventSeriesRepository,
  PrismaParticipantProviderMappingRepository,
  PrismaParticipantRepository,
  PrismaSportEventParticipantGolfRoundRepository,
  PrismaSportEventParticipantGolfStandingRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventParticipantValuationRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
  PrismaSportEventTierRepository,
  PrismaSportLeagueRepository,
} from '../../../packages/core-api/src/adapters';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { freshEventEdition } from '../../support/event-edition';

// The event-core write ports and the golf extension ports (#236) against real Postgres:
// what each write leaves in the tables, that "all or none" is all or none, and that
// removal takes an event's or a field row's children with it. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const TIERS = [
  { tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1, defaultPickCount: 1 },
  { tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2, defaultPickCount: 1 },
];

function repos() {
  const prisma = getPrisma();
  return {
    events: new PrismaSportEventRepository(prisma),
    eventSeries: new PrismaEventSeriesRepository(prisma),
    rounds: new PrismaSportEventRoundRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    tiers: new PrismaSportEventTierRepository(prisma),
    valuations: new PrismaSportEventParticipantValuationRepository(prisma),
    golfRounds: new PrismaSportEventParticipantGolfRoundRepository(prisma),
    golfStandings: new PrismaSportEventParticipantGolfStandingRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    mappings: new PrismaParticipantProviderMappingRepository(prisma),
  };
}

async function golfSportId(): Promise<string> {
  const sport = await getPrisma().sport.upsert({
    where: { name: Sport.GOLF },
    create: { name: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  return sport.id;
}

async function createEvent(name = 'Repository Open') {
  return repos().events.create({
    ...(await freshEventEdition(getPrisma())),
    externalId: `repo-${randomUUID()}`,
    providerId: 'integration-test',
    sport: Sport.GOLF,
    name,
    venue: 'Harbour Links',
    startDate: new Date('2026-06-04T12:00:00.000Z'),
    endDate: new Date('2026-06-07T12:00:00.000Z'),
    status: 'SCHEDULED',
    rounds: 4,
    releaseAt: new Date('2026-05-21T12:00:00.000Z'),
    fieldLocksAt: new Date('2026-06-03T12:00:00.000Z'),
    syncScope: 'NONE',
    autoLifecycleEnabled: true,
  });
}

async function createParticipants(names: string[]) {
  const sportId = await golfSportId();
  return Promise.all(names.map((name) => getPrisma().participant.create({
    data: { sportId, name, participantType: 'INDIVIDUAL' },
  })));
}

/** An event with one scored, standing, valued golfer on its field, two rounds and two tiers. */
async function createPopulatedEvent() {
  const { rounds, field, tiers, valuations, golfRounds, golfStandings } = repos();
  const event = await createEvent();
  const [golfer] = await createParticipants(['Populated Golfer']);
  await rounds.createMany(event.id, [
    { roundNumber: 1, scheduledDate: new Date('2026-06-04T12:00:00.000Z') },
    { roundNumber: 2, scheduledDate: new Date('2026-06-05T12:00:00.000Z') },
  ]);
  await tiers.createMany(event.id, TIERS);
  await field.createMany(event.id, [{ participantId: golfer.id, seedNumber: 1 }]);
  const [entry] = await field.findBySportEvent(event.id);
  const [tier] = await tiers.findBySportEvent(event.id);
  await valuations.assignTiers([{ sportEventParticipantId: entry.id, sportEventTierId: tier.id, tierOrderIndex: 1, source: 'MANUAL' }]);
  const [round] = await rounds.findBySportEvent(event.id);
  await golfRounds.upsert({
    sportEventParticipantId: entry.id, sportEventRoundId: round.id, status: 'COMPLETED', completedAt: null,
    strokes: 70, scoreToPar: -2, thru: 18,
  });
  await golfStandings.upsert({
    sportEventParticipantId: entry.id, currentRound: 1, status: 'COMPLETE', asOf: new Date(),
    eventScoreToPar: -2, eventStrokes: 70, currentRoundThru: 18,
  });
  return { event, entry, golfer };
}

describe('SportEventRepository — writes', () => {
  it('creates an event, finds it by provider identity, and clears nullable fields with null but leaves undefined ones alone', async () => {
    const { events } = repos();
    const event = await createEvent();

    await expect(events.findByProviderRef('integration-test', event.externalId)).resolves.toMatchObject({ id: event.id });
    await expect(events.findByProviderRef('integration-test', 'nobody')).resolves.toBeNull();

    const updated = await events.update(event.id, { venue: null, endDate: null, name: 'Renamed Open', location: undefined });

    expect(updated).toMatchObject({ name: 'Renamed Open', venue: undefined, endDate: undefined, rounds: 4 });
  });

  it('filters by a case-insensitive name substring', async () => {
    const { events } = repos();
    await createEvent('Harbour Classic');
    await createEvent('Desert Open');

    expect((await events.findAll({ q: 'harbour' })).map((row) => row.name)).toEqual(['Harbour Classic']);
  });

  it('deletes an event that has rounds, tiers and a scored, valued field — which a bare event delete could not', async () => {
    const { events } = repos();
    const { event } = await createPopulatedEvent();

    await events.delete(event.id);

    const prisma = getPrisma();
    await expect(events.findById(event.id)).resolves.toBeNull();
    await expect(prisma.sportEventRound.count({ where: { sportEventId: event.id } })).resolves.toBe(0);
    await expect(prisma.sportEventTier.count({ where: { sportEventId: event.id } })).resolves.toBe(0);
    await expect(prisma.sportEventParticipant.count({ where: { sportEventId: event.id } })).resolves.toBe(0);
    await expect(prisma.sportEventParticipantGolfRound.count()).resolves.toBe(0);
    await expect(prisma.sportEventParticipantGolfStanding.count()).resolves.toBe(0);
  });

  it('counts tiers and contests per event, zero where there are none', async () => {
    const { events, tiers } = repos();
    const withTiers = await createEvent('With Tiers');
    const bare = await createEvent('Bare');
    await tiers.createMany(withTiers.id, TIERS);
    const fixture = await createContestFixture(withTiers.id);

    expect(await events.countTiers([withTiers.id, bare.id])).toEqual(new Map([[withTiers.id, 2], [bare.id, 0]]));
    expect(await events.countContests([withTiers.id, bare.id])).toEqual(new Map([[withTiers.id, 1], [bare.id, 0]]));
    expect(fixture.contestId).toBeDefined();
  });

  it('finds the lifecycle scheduler\'s candidates: auto lifecycle on, not provider-owned, scheduled or in progress', async () => {
    const { events } = repos();
    const scheduled = await createEvent('Scheduled');
    const inProgress = await createEvent('In Progress');
    await events.update(inProgress.id, { status: 'IN_PROGRESS' });
    const completed = await createEvent('Completed');
    await events.update(completed.id, { status: 'COMPLETED' });
    const manualOverride = await createEvent('Manual Override');
    await events.update(manualOverride.id, { autoLifecycleEnabled: false });
    const providerOwned = await createEvent('Provider Owned');
    await events.update(providerOwned.id, { syncScope: 'FULL' });
    const scoresOnly = await createEvent('Scores Only');
    await events.update(scoresOnly.id, { syncScope: 'SCORES_ONLY' });

    const created = new Set([scheduled.id, inProgress.id, completed.id, manualOverride.id, providerOwned.id, scoresOnly.id]);
    const candidates = (await events.findAutoLifecycleCandidates()).filter((event) => created.has(event.id));

    expect(candidates.map((event) => event.name).sort()).toEqual(['In Progress', 'Scheduled', 'Scores Only']);
  });
});

describe('EventSeriesRepository', () => {
  it('finds a sport league\'s recurring event by name, creating it only the first time', async () => {
    const sportId = await golfSportId();
    const sportLeague = await new PrismaSportLeagueRepository(getPrisma()).create({ sportId, name: 'PGA Tour', matchKeyword: null });
    const { eventSeries } = repos();

    const first = await eventSeries.findOrCreate(sportLeague.id, 'The Masters');
    const again = await eventSeries.findOrCreate(sportLeague.id, 'The Masters');

    expect(again.id).toBe(first.id);
    await expect(getPrisma().eventSeries.count({ where: { sportLeagueId: sportLeague.id } })).resolves.toBe(1);
  });

  // plans/147 decision 9 (#314) — a series is a dimension with a lifecycle, and starts active.
  it('creates a series active', async () => {
    const sportId = await golfSportId();
    const sportLeague = await new PrismaSportLeagueRepository(getPrisma()).create({ sportId, name: 'PGA Tour', matchKeyword: null });

    const series = await repos().eventSeries.findOrCreate(sportLeague.id, 'The Masters');

    expect(series.isActive).toBe(true);
  });
});

describe('SportEventRoundRepository — writes', () => {
  it('reschedules all or none: an unknown round number leaves every round where it was', async () => {
    const { rounds } = repos();
    const event = await createEvent();
    await rounds.createMany(event.id, [{ roundNumber: 1, scheduledDate: new Date('2026-06-04T12:00:00.000Z') }]);

    await expect(rounds.reschedule(event.id, [
      { roundNumber: 1, scheduledDate: new Date('2026-06-05T12:00:00.000Z') },
      { roundNumber: 9, scheduledDate: new Date('2026-06-06T12:00:00.000Z') },
    ])).rejects.toBeDefined();

    const [round] = await rounds.findBySportEvent(event.id);
    expect(round.scheduledDate).toEqual(new Date('2026-06-04T12:00:00.000Z'));
  });

  it('finds or creates a round by number without disturbing an existing one', async () => {
    const { rounds } = repos();
    const event = await createEvent();
    await rounds.createMany(event.id, [{ roundNumber: 1, scheduledDate: new Date('2026-06-04T12:00:00.000Z') }]);

    const existing = await rounds.findOrCreate(event.id, 1);
    const created = await rounds.findOrCreate(event.id, 2);

    expect(existing.scheduledDate).toEqual(new Date('2026-06-04T12:00:00.000Z'));
    expect((await rounds.findBySportEvent(event.id)).map((row) => row.roundNumber)).toEqual([1, 2]);
    expect(created.roundNumber).toBe(2);
  });

  it('reads several events\' rounds at once, in round order, with an empty list for an event without rounds', async () => {
    const { rounds } = repos();
    const withRounds = await createEvent('With Rounds');
    const without = await createEvent('Without Rounds');
    await rounds.createMany(withRounds.id, [
      { roundNumber: 2, scheduledDate: new Date('2026-06-05T12:00:00.000Z') },
      { roundNumber: 1, scheduledDate: new Date('2026-06-04T12:00:00.000Z') },
    ]);

    const byEvent = await rounds.findBySportEvents([withRounds.id, without.id]);

    expect(byEvent.get(withRounds.id)?.map((round) => round.roundNumber)).toEqual([1, 2]);
    expect(byEvent.get(without.id)).toEqual([]);
    expect(await rounds.findBySportEvents([])).toEqual(new Map());
  });
});

describe('SportEventParticipantRepository — the field', () => {
  it('orders by seed with unseeded last, and upserts by participant without duplicating', async () => {
    const { field } = repos();
    const event = await createEvent();
    const [ana, ben, cal] = await createParticipants(['Ana', 'Ben', 'Cal']);
    await field.createMany(event.id, [
      { participantId: ana.id },
      { participantId: ben.id, seedNumber: 2 },
      { participantId: cal.id, seedNumber: 1 },
    ]);

    await field.upsertMany(event.id, [{ participantId: ana.id, seedNumber: 3, ranking: 40 }]);

    const rows = await field.findBySportEvent(event.id);
    expect(rows.map((row) => [row.participantId, row.seedNumber])).toEqual([[cal.id, 1], [ben.id, 2], [ana.id, 3]]);
    expect(rows[2].ranking).toBe(40);
  });

  it('patches rows and manual prices all or none; undefined leaves a column, null clears it', async () => {
    const { field, valuations } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await field.createMany(event.id, [{ participantId: ana.id, ranking: 5, seedNumber: 1 }]);
    const [entry] = await field.findBySportEvent(event.id);

    await field.updateMany([{ id: entry.id, updates: { ranking: null, oddsToWin: 12.5 }, price: 9.5 }]);
    await expect(field.updateMany([
      { id: entry.id, updates: { seedNumber: 7 } },
      { id: randomUUID(), updates: { seedNumber: 8 } },
    ])).rejects.toBeDefined();

    const [after] = await field.findBySportEvent(event.id);
    expect(after).toMatchObject({ ranking: undefined, oddsToWin: 12.5, seedNumber: 1 });
    const [valuation] = await valuations.findBySportEvent(event.id);
    expect(valuation).toMatchObject({ price: 9.5, priceAssignedSource: 'MANUAL', sportEventTierId: null });
  });

  it('removes a field row with its valuation, standing and scored rounds, and counts picks', async () => {
    const { field } = repos();
    const { event, entry } = await createPopulatedEvent();

    await expect(field.countPicks(entry.id)).resolves.toBe(0);
    await field.delete(entry.id);

    await expect(field.findBySportEvent(event.id)).resolves.toEqual([]);
    await expect(getPrisma().sportEventParticipantValuation.count()).resolves.toBe(0);
    await expect(getPrisma().sportEventParticipantStanding.count()).resolves.toBe(0);
    await expect(getPrisma().sportEventParticipantRound.count()).resolves.toBe(0);
  });

  it('counts the contest-entry picks made of a field row', async () => {
    const { field } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);
    const fixture = await createContestFixture(event.id);
    await getPrisma().contestEntryPick.create({
      data: { entryId: fixture.entryId, sportEventParticipantId: entry.id, contestFormat: 'ROSTER', isAutoPicked: false },
    });

    await expect(field.countPicks(entry.id)).resolves.toBe(1);
  });
});

describe('SportEventTierRepository and valuations', () => {
  it('replaces tiers: swaps numbers without a unique clash and moves a removed tier\'s valuations to the named tier', async () => {
    const { tiers, valuations, field } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await tiers.createMany(event.id, [...TIERS, { tierKey: 'tier-3', label: 'Tier 3', tierNumber: 3, defaultPickCount: 1 }]);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);
    const tier3 = (await tiers.findBySportEvent(event.id))[2];
    await valuations.assignTiers([{ sportEventParticipantId: entry.id, sportEventTierId: tier3.id, tierOrderIndex: 4, source: 'AUTO_ODDS' }]);

    await tiers.replace(event.id, [
      { tierKey: 'tier-1', label: 'Tier 1', tierNumber: 2, defaultPickCount: 1 },
      { tierKey: 'tier-2', label: 'Top', tierNumber: 1, defaultPickCount: 2 },
    ], 'tier-2');

    const after = await tiers.findBySportEvent(event.id);
    expect(after.map((tier) => [tier.tierKey, tier.tierNumber, tier.label])).toEqual([['tier-2', 1, 'Top'], ['tier-1', 2, 'Tier 1']]);
    const [valuation] = await valuations.findBySportEvent(event.id);
    expect(valuation).toMatchObject({ sportEventTierId: after[0].id, tierOrderIndex: null });
    expect(await tiers.countValuations(event.id)).toEqual(new Map([[after[0].id, 1], [after[1].id, 0]]));
  });

  it('leaves a removed tier\'s valuations without a tier when no target is named', async () => {
    const { tiers, valuations, field } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await tiers.createMany(event.id, TIERS);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);
    const [, tier2] = await tiers.findBySportEvent(event.id);
    await valuations.assignTiers([{ sportEventParticipantId: entry.id, sportEventTierId: tier2.id, tierOrderIndex: 1, source: 'MANUAL' }]);

    await tiers.replace(event.id, [TIERS[0]]);

    await expect(valuations.findBySportEvent(event.id)).resolves.toEqual([expect.objectContaining({ sportEventTierId: null })]);
  });

  it('sets tier and price independently, each all or none', async () => {
    const { tiers, valuations, field } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await tiers.createMany(event.id, TIERS);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);
    const [tier1] = await tiers.findBySportEvent(event.id);

    await valuations.assignTiers([{ sportEventParticipantId: entry.id, sportEventTierId: tier1.id, tierOrderIndex: 1, source: 'AUTO_RANKING' }]);
    await valuations.assignPrices([{ sportEventParticipantId: entry.id, price: 15, source: 'AUTO_ODDS' }]);
    await expect(valuations.assignPrices([
      { sportEventParticipantId: entry.id, price: 99, source: 'MANUAL' },
      { sportEventParticipantId: randomUUID(), price: 1, source: 'MANUAL' },
    ])).rejects.toBeDefined();

    await expect(valuations.findBySportEvent(event.id)).resolves.toEqual([expect.objectContaining({
      sportEventTierId: tier1.id, tierAssignedSource: 'AUTO_RANKING', price: 15, priceAssignedSource: 'AUTO_ODDS',
    })]);
  });
});

describe('Golf extension repositories', () => {
  it('writes a scored round as its core row and golf row under one id link, and updates both in place', async () => {
    const { golfRounds } = repos();
    const { event, entry } = await createPopulatedEvent();

    const [round1] = await golfRounds.findBySportEvent(event.id);
    expect(round1.golf.participantRoundId).toBe(round1.participantRound.id);
    expect(round1).toMatchObject({ participantRound: { roundNumber: 1, status: 'COMPLETED' }, golf: { strokes: 70, scoreToPar: -2 } });

    const rewritten = await golfRounds.upsert({
      sportEventParticipantId: entry.id, sportEventRoundId: round1.participantRound.sportEventRoundId,
      status: 'COMPLETED', completedAt: null, strokes: 69, scoreToPar: -3, thru: 18,
    });

    expect(rewritten.participantRound.id).toBe(round1.participantRound.id);
    await expect(getPrisma().sportEventParticipantGolfRound.count()).resolves.toBe(1);
    await expect(golfRounds.findBySportEventParticipants([entry.id])).resolves.toEqual([
      expect.objectContaining({ golf: expect.objectContaining({ strokes: 69 }) }),
    ]);
  });

  it('writes many rounds all or none', async () => {
    const { golfRounds, rounds } = repos();
    const { event, entry } = await createPopulatedEvent();
    const [, round2] = await rounds.findBySportEvent(event.id);

    await expect(golfRounds.upsertMany([
      { sportEventParticipantId: entry.id, sportEventRoundId: round2.id, status: 'COMPLETED', completedAt: null, strokes: 72, scoreToPar: 0, thru: 18 },
      { sportEventParticipantId: randomUUID(), sportEventRoundId: round2.id, status: 'COMPLETED', completedAt: null, strokes: 72, scoreToPar: 0, thru: 18 },
    ])).rejects.toBeDefined();

    await expect(golfRounds.findBySportEventRound(round2.id)).resolves.toEqual([]);
  });

  it('upserts a standing with its golf totals and reads it back by event and by field row', async () => {
    const { golfStandings } = repos();
    const { event, entry } = await createPopulatedEvent();

    await golfStandings.upsert({
      sportEventParticipantId: entry.id, currentRound: 2, status: 'IN_PROGRESS', asOf: new Date(),
      eventScoreToPar: -5, eventStrokes: 139, currentRoundThru: 9,
    });

    const [byEvent] = await golfStandings.findBySportEvent(event.id);
    expect(byEvent).toMatchObject({ standing: { currentRound: 2, status: 'IN_PROGRESS' }, golf: { eventScoreToPar: -5, currentRoundThru: 9 } });
    expect(byEvent.golf.standingId).toBe(byEvent.standing.id);
    await expect(golfStandings.findBySportEventParticipants([entry.id])).resolves.toHaveLength(1);
  });
});

describe('Participant and provider-mapping repositories — additions', () => {
  it('finds participants by ids, and provider mappings by participants and by a provider\'s identifiers', async () => {
    const { participants, mappings } = repos();
    const [ana] = await createParticipants(['Ana']);
    await getPrisma().participantProviderMapping.create({
      data: { participantId: ana.id, providerId: 'integration-test', externalId: 'pg-1', confidence: 'EXACT' },
    });

    await expect(participants.findByIds([ana.id, randomUUID()])).resolves.toEqual([expect.objectContaining({ id: ana.id })]);
    await expect(mappings.findByParticipants([ana.id])).resolves.toEqual([expect.objectContaining({ externalId: 'pg-1' })]);
    await expect(mappings.findByProviderExternalIds('integration-test', ['pg-1', 'pg-2'])).resolves.toEqual([
      expect.objectContaining({ participantId: ana.id }),
    ]);
  });
});

async function createContestFixture(sportEventId: string) {
  const prisma = getPrisma();
  const { user } = await createTestUser();
  const suffix = randomUUID().slice(0, 8);
  const league = await prisma.league.create({
    data: { leagueCode: `REPO${suffix.toUpperCase()}`, name: `Repository League ${suffix}`, iconKey: 'TROPHY', joinPolicy: 'COMMISSIONER_ONLY' },
  });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const squad = await prisma.squad.create({ data: { leagueId: league.id, name: `Repository Squad ${suffix}`, createdBy: user.id } });
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id, sportEventId, name: `Repository Contest ${suffix}`, status: 'OPEN',
      contestFormat: 'ROSTER', selectionType: 'TIERED', scoringEngine: 'STROKE_PLAY',
    },
  });
  const entry = await prisma.contestEntry.create({
    data: { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: `Entry ${suffix}`, status: 'ACTIVE' },
  });
  return { contestId: contest.id, entryId: entry.id };
}
