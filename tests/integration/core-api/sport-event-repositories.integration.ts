import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { BracketAdvancement, ParticipantInactiveReason, Sport } from '@poolmaster/shared/domain';
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
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { createRoundRows, createSportEventRow, createTierRows, seriesNamed } from '../../support/sport-event-rows';
import { freshEventEdition } from '../../support/event-edition';
import { standardEventPricing } from '../../support/budget-pricing';
import { expectDefined } from '../../support/expect-defined';

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
  { tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1 },
  { tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2 },
];

function repos() {
  return {
    events: new PrismaSportEventRepository(getAppPrisma()),
    eventSeries: new PrismaEventSeriesRepository(getAppPrisma()),
    rounds: new PrismaSportEventRoundRepository(getAppPrisma()),
    field: new PrismaSportEventParticipantRepository(getAppPrisma()),
    tiers: new PrismaSportEventTierRepository(getAppPrisma()),
    valuations: new PrismaSportEventParticipantValuationRepository(getAppPrisma()),
    golfRounds: new PrismaSportEventParticipantGolfRoundRepository(getAppPrisma()),
    golfStandings: new PrismaSportEventParticipantGolfStandingRepository(getAppPrisma()),
    participants: new PrismaParticipantRepository(getAppPrisma()),
    mappings: new PrismaParticipantProviderMappingRepository(getAppPrisma()),
  };
}

async function golfSportId(): Promise<string> {
  const sport = await getPrisma().sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  return sport.id;
}

async function createEvent(name = 'Repository Open') {
  return createSportEventRow(repos().events, {
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
  await createRoundRows(rounds, event.id, [
    { roundNumber: 1, scheduledDate: new Date('2026-06-04T12:00:00.000Z') },
    { roundNumber: 2, scheduledDate: new Date('2026-06-05T12:00:00.000Z') },
  ]);
  await createTierRows(tiers, event.id, TIERS);
  await field.createMany(event.id, [{ participantId: golfer.id, seedNumber: 1 }]);
  const [entry] = await field.findBySportEvent(event.id);
  const [tier] = await tiers.findBySportEvent(event.id);
  await valuations.assignTiers([{ sportEventParticipantId: entry.id, sportEventTierId: tier.id, tierOrderIndex: 1, source: 'MANUAL' }]);
  const [round] = await rounds.findBySportEvent(event.id);
  await golfRounds.upsert({
    sportEventParticipantId: entry.id, sportEventRoundId: round.id, status: 'COMPLETED', completedAt: null,
    strokes: 70, scoreToPar: -2, thru: 18,
  });
  await golfStandings.upsertMany([{
    sportEventParticipantId: entry.id, currentRound: 1, status: 'COMPLETE', asOf: new Date(),
    eventScoreToPar: -2, eventStrokes: 70, currentRoundThru: 18,
  }]);
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
    await createTierRows(tiers, withTiers.id, TIERS);
    const fixture = await createContestFixture(withTiers.id);

    expect(await events.countTiers([withTiers.id, bare.id])).toEqual(new Map([[withTiers.id, 2], [bare.id, 0]]));
    expect(await events.countContests([withTiers.id, bare.id])).toEqual(new Map([[withTiers.id, 1], [bare.id, 0]]));
    expect(fixture.contestId).toBeDefined();
  });

  it('lists, in tier order, the labels of the tiers no active participant is in — a tier holding only a withdrawn one counts as empty', async () => {
    const { events, tiers, field, valuations } = repos();
    const event = await createEvent('Empty Tiers');
    const bare = await createEvent('No Tiers');
    await createTierRows(tiers, event.id, [...TIERS, { tierKey: 'tier-3', label: 'Tier 3', tierNumber: 3 }]);
    const [active, withdrawn] = await createParticipants(['Active Golfer', 'Withdrawn Golfer']);
    await field.createMany(event.id, [{ participantId: active.id }, { participantId: withdrawn.id }]);
    await getPrisma().sportEventParticipant.updateMany({ where: { participantId: withdrawn.id }, data: { isActive: false } });
    const entries = await field.findBySportEvent(event.id);
    const [tier1, tier2] = await tiers.findBySportEvent(event.id);
    await valuations.assignTiers(entries.map((entry) => ({
      sportEventParticipantId: entry.id,
      sportEventTierId: entry.participantId === active.id ? tier1.id : tier2.id,
      tierOrderIndex: 1,
      source: 'MANUAL',
    })));

    expect(await events.findEmptyTierLabels([event.id, bare.id])).toEqual(new Map([[event.id, ['Tier 2', 'Tier 3']], [bare.id, []]]));
  });

  it('finds the lifecycle scheduler\'s candidates: auto lifecycle on and scheduled or in progress, linked to a provider or not', async () => {
    const { events } = repos();
    const scheduled = await createEvent('Scheduled');
    const inProgress = await createEvent('In Progress');
    await events.update(inProgress.id, { status: 'IN_PROGRESS' });
    const completed = await createEvent('Completed');
    await events.update(completed.id, { status: 'COMPLETED' });
    const manualOverride = await createEvent('Manual Override');
    await events.update(manualOverride.id, { autoLifecycleEnabled: false });
    const scoresOnly = await createEvent('Scores Only');
    await events.update(scoresOnly.id, { syncScope: 'SCORES_ONLY' });

    const created = new Set([scheduled.id, inProgress.id, completed.id, manualOverride.id, scoresOnly.id]);
    const candidates = (await events.findAutoLifecycleCandidates()).filter((event) => created.has(event.id));

    expect(candidates.map((event) => event.name).sort()).toEqual(['In Progress', 'Scheduled', 'Scores Only']);
  });
});

describe('EventSeriesRepository', () => {
  it('finds a sport league\'s recurring event by name, creating it only the first time', async () => {
    const sportId = await golfSportId();
    const sportLeague = await new PrismaSportLeagueRepository(getAppPrisma()).create({ sportId, name: 'PGA Tour', matchKeyword: null, bracketAdvancement: BracketAdvancement.FIXED });
    const { eventSeries } = repos();

    const first = await seriesNamed(eventSeries, sportLeague.id, 'The Masters');
    const again = await seriesNamed(eventSeries, sportLeague.id, 'The Masters');

    expect(again.id).toBe(first.id);
    await expect(getPrisma().eventSeries.count({ where: { sportLeagueId: sportLeague.id } })).resolves.toBe(1);
  });

  // plans/147 decision 9 (#314) — a series is a dimension with a lifecycle, and starts active.
  it('creates a series active', async () => {
    const sportId = await golfSportId();
    const sportLeague = await new PrismaSportLeagueRepository(getAppPrisma()).create({ sportId, name: 'PGA Tour', matchKeyword: null, bracketAdvancement: BracketAdvancement.FIXED });

    const series = await seriesNamed(repos().eventSeries, sportLeague.id, 'The Masters');

    expect(series.isActive).toBe(true);
  });
});

describe('SportEventRoundRepository — writes', () => {
  it('creates every round in one write, keeping each round\'s own end time or none', async () => {
    const { rounds } = repos();
    const event = await createEvent();

    await rounds.createMany([
      { sportEventId: event.id, roundNumber: 1, scheduledDate: new Date('2026-06-04T12:00:00.000Z'), scheduledEndAt: new Date('2026-06-04T22:00:00.000Z') },
      { sportEventId: event.id, roundNumber: 2, scheduledDate: new Date('2026-06-05T12:00:00.000Z') },
    ]);

    const created = await rounds.findBySportEvent(event.id);
    expect(created.map((round) => [round.roundNumber, round.scheduledEndAt ?? null])).toEqual([
      [1, new Date('2026-06-04T22:00:00.000Z')],
      [2, null],
    ]);
  });

  it('reschedules all or none: an unknown round number leaves every round where it was', async () => {
    const { rounds } = repos();
    const event = await createEvent();
    await createRoundRows(rounds, event.id, [{ roundNumber: 1, scheduledDate: new Date('2026-06-04T12:00:00.000Z') }]);

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
    await createRoundRows(rounds, event.id, [{ roundNumber: 1, scheduledDate: new Date('2026-06-04T12:00:00.000Z') }]);

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
    await createRoundRows(rounds, withRounds.id, [
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
  it('adds a field in one write, all or none: a participant named twice leaves the field empty', async () => {
    const { field } = repos();
    const event = await createEvent();
    const [ana, ben] = await createParticipants(['Ana', 'Ben']);

    await expect(field.createMany(event.id, [
      { participantId: ana.id },
      { participantId: ben.id },
      { participantId: ana.id },
    ])).rejects.toBeDefined();

    expect(await field.findBySportEvent(event.id)).toEqual([]);
  });

  it('adds rows that set different optional columns in one write, defaulting the ones a row leaves out', async () => {
    const { field } = repos();
    const event = await createEvent();
    const [ana, ben] = await createParticipants(['Ana', 'Ben']);

    await field.createMany(event.id, [
      { participantId: ana.id, seedNumber: 1, isActive: false, inactiveReason: ParticipantInactiveReason.WITHDRAWN },
      { participantId: ben.id },
    ]);

    const rows = await field.findBySportEvent(event.id);
    expect(rows.map((row) => [row.participantId, row.seedNumber, row.isActive])).toEqual([
      [ana.id, 1, false],
      [ben.id, undefined, true],
    ]);
  });

  it('orders the field by seed with unseeded participants last', async () => {
    const { field } = repos();
    const event = await createEvent();
    const [ana, ben, cal] = await createParticipants(['Ana', 'Ben', 'Cal']);
    await field.createMany(event.id, [
      { participantId: ana.id },
      { participantId: ben.id, seedNumber: 2 },
      { participantId: cal.id, seedNumber: 1 },
    ]);

    const rows = await field.findBySportEvent(event.id);
    expect(rows.map((row) => [row.participantId, row.seedNumber])).toEqual([[cal.id, 1], [ben.id, 2], [ana.id, undefined]]);
  });

  it('counts each participant once across several events\' fields, leaving out events not asked for', async () => {
    const { field } = repos();
    const [week1, week2, other] = [await createEvent('Week 1'), await createEvent('Week 2'), await createEvent('Other')];
    const [ana, ben, cal, dee] = await createParticipants(['Ana', 'Ben', 'Cal', 'Dee']);
    await field.createMany(week1.id, [{ participantId: ana.id }, { participantId: ben.id }]);
    await field.createMany(week2.id, [{ participantId: ben.id }, { participantId: cal.id }]);
    await field.createMany(other.id, [{ participantId: dee.id }]);

    expect(await field.countDistinctParticipants([week1.id, week2.id])).toBe(3);
    expect(await field.countDistinctParticipants([])).toBe(0);
  });

  it('reads field rows by id, leaving out an id with no row, and several events\' fields at once, each by seed, leaving out events not asked for', async () => {
    const { field } = repos();
    const [week1, week2, other] = [await createEvent('Week 1'), await createEvent('Week 2'), await createEvent('Other')];
    const [ana, ben, cal, dee] = await createParticipants(['Ana', 'Ben', 'Cal', 'Dee']);
    await field.createMany(week1.id, [{ participantId: ana.id }, { participantId: ben.id, seedNumber: 1 }]);
    await field.createMany(week2.id, [{ participantId: cal.id }]);
    await field.createMany(other.id, [{ participantId: dee.id }]);
    const [benRow, anaRow] = await field.findBySportEvent(week1.id);

    const byId = await field.findByIds([anaRow.id, benRow.id, randomUUID()]);
    expect(byId.map((row) => row.participantId).sort()).toEqual([ana.id, ben.id].sort());
    expect(await field.findByIds([])).toEqual([]);

    const both = await field.findBySportEvents([week1.id, week2.id]);
    expect(both.filter((row) => row.sportEventId === week1.id).map((row) => row.participantId)).toEqual([ben.id, ana.id]);
    expect(both.filter((row) => row.sportEventId === week2.id).map((row) => row.participantId)).toEqual([cal.id]);
    expect(both).toHaveLength(3);
    expect(await field.findBySportEvents([])).toEqual([]);
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
    await createTierRows(tiers, event.id, [...TIERS, { tierKey: 'tier-3', label: 'Tier 3', tierNumber: 3 }]);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);
    const tier3 = (await tiers.findBySportEvent(event.id))[2];
    await valuations.assignTiers([{ sportEventParticipantId: entry.id, sportEventTierId: tier3.id, tierOrderIndex: 4, source: 'AUTO_ODDS' }]);

    await tiers.replace(event.id, [
      { tierKey: 'tier-1', label: 'Tier 1', tierNumber: 2 },
      { tierKey: 'tier-2', label: 'Top', tierNumber: 1 },
    ], 'tier-2');

    const after = await tiers.findBySportEvent(event.id);
    expect(after.map((tier) => [tier.tierKey, tier.tierNumber, tier.label])).toEqual([['tier-2', 1, 'Top'], ['tier-1', 2, 'Tier 1']]);
    const [valuation] = await valuations.findBySportEvent(event.id);
    expect(valuation).toMatchObject({ sportEventTierId: after[0].id, tierOrderIndex: null });
    expect(await tiers.countValuations(event.id)).toEqual(new Map([[after[0].id, 1], [after[1].id, 0]]));
  });

  it('moves a removed tier\'s valuations to a tier added in the same save', async () => {
    const { tiers, valuations, field } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await createTierRows(tiers, event.id, TIERS);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);
    const [, tier2] = await tiers.findBySportEvent(event.id);
    await valuations.assignTiers([{ sportEventParticipantId: entry.id, sportEventTierId: tier2.id, tierOrderIndex: 1, source: 'MANUAL' }]);

    await tiers.replace(event.id, [TIERS[0], { tierKey: 'tier-late', label: 'Late Adds', tierNumber: 2 }], 'tier-late');

    const after = await tiers.findBySportEvent(event.id);
    expect(after.map((tier) => [tier.tierKey, tier.tierNumber])).toEqual([['tier-1', 1], ['tier-late', 2]]);
    await expect(valuations.findBySportEvent(event.id)).resolves.toEqual([expect.objectContaining({ sportEventTierId: after[1].id, tierOrderIndex: null })]);
  });

  it('leaves a removed tier\'s valuations without a tier when no target is named', async () => {
    const { tiers, valuations, field } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await createTierRows(tiers, event.id, TIERS);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);
    const [, tier2] = await tiers.findBySportEvent(event.id);
    await valuations.assignTiers([{ sportEventParticipantId: entry.id, sportEventTierId: tier2.id, tierOrderIndex: 1, source: 'MANUAL' }]);

    await tiers.replace(event.id, [TIERS[0]]);

    await expect(valuations.findBySportEvent(event.id)).resolves.toEqual([expect.objectContaining({ sportEventTierId: null })]);
  });

  it('reads several events\' tiers, each in tier order, and their valuations at once, leaving out events not asked for', async () => {
    const { tiers, valuations, field } = repos();
    const [first, second, other] = [await createEvent('First'), await createEvent('Second'), await createEvent('Other')];
    const [ana, ben, cal] = await createParticipants(['Ana', 'Ben', 'Cal']);
    for (const event of [first, second, other]) await createTierRows(tiers, event.id, [TIERS[1], TIERS[0]]);
    await field.createMany(first.id, [{ participantId: ana.id }]);
    await field.createMany(second.id, [{ participantId: ben.id }]);
    await field.createMany(other.id, [{ participantId: cal.id }]);
    const assign = async (sportEventId: string) => {
      const [entry] = await field.findBySportEvent(sportEventId);
      const [tier] = await tiers.findBySportEvent(sportEventId);
      await valuations.assignTiers([{ sportEventParticipantId: entry.id, sportEventTierId: tier.id, tierOrderIndex: 1, source: 'MANUAL' }]);
      return entry;
    };
    const [anaRow, benRow] = [await assign(first.id), await assign(second.id)];
    await assign(other.id);

    const read = await tiers.findBySportEvents([first.id, second.id]);
    for (const event of [first, second]) {
      expect(read.filter((tier) => tier.sportEventId === event.id).map((tier) => tier.tierNumber)).toEqual([1, 2]);
    }
    expect(read).toHaveLength(4);
    expect((await valuations.findBySportEvents([first.id, second.id])).map((row) => row.sportEventParticipantId).sort())
      .toEqual([anaRow.id, benRow.id].sort());
    expect(await tiers.findBySportEvents([])).toEqual([]);
    expect(await valuations.findBySportEvents([])).toEqual([]);
  });

  it('sets tier and price independently, each leaving the other in place', async () => {
    const { tiers, valuations, field } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await createTierRows(tiers, event.id, TIERS);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);
    const [tier1] = await tiers.findBySportEvent(event.id);

    await valuations.assignTiers([{ sportEventParticipantId: entry.id, sportEventTierId: tier1.id, tierOrderIndex: 1, source: 'AUTO_RANKING' }]);
    await valuations.assignEventPrices({
      sportEventId: event.id,
      pricingConfig: standardEventPricing(),
      assignments: [{ sportEventParticipantId: entry.id, price: 15, source: 'AUTO_ODDS' }],
    });

    await expect(valuations.findBySportEvent(event.id)).resolves.toEqual([expect.objectContaining({
      sportEventTierId: tier1.id, tierAssignedSource: 'AUTO_RANKING', price: 15, priceAssignedSource: 'AUTO_ODDS',
    })]);
  });
});

// #787: a sport league's first squares round reads onto each of its events, as its period
// layout does; a league without one leaves the event's unset.
describe('The sport league\'s first squares round on the event read', () => {
  it('reads the league\'s squaresFromRound onto its event, and leaves it unset for a league without one', async () => {
    const prisma = getPrisma();
    const { events } = repos();
    const league = await prisma.sportLeague.create({ data: { sportId: await golfSportId(), name: `Squares round league ${randomUUID()}`, squaresFromRound: 3 } });
    const series = await prisma.eventSeries.create({ data: { sportLeagueId: league.id, name: `Squares round series ${randomUUID()}` } });
    try {
      const withRound = await createSportEventRow(events, {
        eventSeriesId: series.id, eventYear: 2026, externalId: `repo-${randomUUID()}`, providerId: 'integration-test', sport: Sport.GOLF,
        name: 'Squares Round Open', startDate: new Date('2026-06-04T12:00:00.000Z'), status: 'SCHEDULED', syncScope: 'NONE', autoLifecycleEnabled: true,
      });
      const withoutRound = await createEvent();

      expect((await events.findById(withRound.id))?.squaresFromRound).toBe(3);
      expect((await events.findById(withoutRound.id))?.squaresFromRound).toBeUndefined();
    } finally {
      await prisma.sportEvent.deleteMany({ where: { eventSeriesId: series.id } });
      await prisma.eventSeries.delete({ where: { id: series.id } });
      await prisma.sportLeague.delete({ where: { id: league.id } });
    }
  });
});

describe('Budget pricing on the event (#93)', () => {
  it('prices the field and records the pricing values on the event in one write, read back typed', async () => {
    const { events, valuations, field } = repos();
    const event = await createEvent();
    const [ana, ben] = await createParticipants(['Ana', 'Ben']);
    await field.createMany(event.id, [{ participantId: ana.id }, { participantId: ben.id }]);
    const [first, second] = await field.findBySportEvent(event.id);

    await valuations.assignEventPrices({
      sportEventId: event.id,
      pricingConfig: standardEventPricing(),
      assignments: [
        { sportEventParticipantId: first.id, price: 12000, source: 'AUTO_RANKING' },
        { sportEventParticipantId: second.id, price: 6000, source: 'AUTO_RANKING' },
      ],
    });

    expect((await events.findById(event.id))?.pricingConfig).toEqual(standardEventPricing());
    expect((await valuations.findBySportEvent(event.id)).map((row) => row.price)).toEqual(expect.arrayContaining([12000, 6000]));
  });

  it('writes neither the prices nor the event\'s pricing values when one price fails', async () => {
    const { events, valuations, field } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);

    await expect(valuations.assignEventPrices({
      sportEventId: event.id,
      pricingConfig: standardEventPricing(),
      assignments: [
        { sportEventParticipantId: entry.id, price: 12000, source: 'AUTO_RANKING' },
        { sportEventParticipantId: randomUUID(), price: 6000, source: 'AUTO_RANKING' },
      ],
    })).rejects.toBeDefined();

    expect((await events.findById(event.id))?.pricingConfig).toBeUndefined();
    await expect(valuations.findBySportEvent(event.id)).resolves.toEqual([]);
  });

  it('counts the active golfers with no price, skipping withdrawn ones and ones priced manually', async () => {
    const { events, valuations, field } = repos();
    const event = await createEvent();
    const [ana, ben, cal, dee] = await createParticipants(['Ana', 'Ben', 'Cal', 'Dee']);
    await field.createMany(event.id, [
      { participantId: ana.id },
      { participantId: ben.id },
      { participantId: cal.id },
      { participantId: dee.id, isActive: false },
    ]);
    const rows = await field.findBySportEvent(event.id);
    const priced = expectDefined(rows.find((row) => row.participantId === ana.id));
    await valuations.assignEventPrices({
      sportEventId: event.id,
      pricingConfig: standardEventPricing(),
      assignments: [{ sportEventParticipantId: priced.id, price: 9000, source: 'MANUAL' }],
    });

    await expect(events.countUnpricedActiveParticipants([event.id])).resolves.toEqual(new Map([[event.id, 2]]));
  });
});

describe('Golf extension repositories', () => {
  it('writes a scored round as its core row and golf row under one id link, and updates both in place', async () => {
    const { golfRounds } = repos();
    const { entry } = await createPopulatedEvent();

    const [round1] = await golfRounds.findBySportEventParticipants([entry.id]);
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

  it('writes many rounds in one call and returns each written round in the order it was given', async () => {
    const { golfRounds, rounds } = repos();
    const { event, entry } = await createPopulatedEvent();
    const [round1, round2] = await rounds.findBySportEvent(event.id);

    const written = await golfRounds.upsertMany([
      { sportEventParticipantId: entry.id, sportEventRoundId: round2.id, status: 'IN_PROGRESS', completedAt: null, strokes: 33, scoreToPar: -3, thru: 9 },
      { sportEventParticipantId: entry.id, sportEventRoundId: round1.id, status: 'COMPLETED', completedAt: null, strokes: 69, scoreToPar: -3, thru: 18 },
    ]);

    expect(written.map((result) => [result.participantRound.roundNumber, result.golf.strokes])).toEqual([[2, 33], [1, 69]]);
    await expect(golfRounds.upsertMany([])).resolves.toEqual([]);
  });

  it('upserts a standing with its golf totals and reads it back by event and by field row', async () => {
    const { golfStandings } = repos();
    const { event, entry } = await createPopulatedEvent();

    await golfStandings.upsertMany([{
      sportEventParticipantId: entry.id, currentRound: 2, status: 'IN_PROGRESS', asOf: new Date(),
      eventScoreToPar: -5, eventStrokes: 139, currentRoundThru: 9,
    }]);

    const [byEvent] = await golfStandings.findBySportEvent(event.id);
    expect(byEvent).toMatchObject({ standing: { currentRound: 2, status: 'IN_PROGRESS' }, golf: { eventScoreToPar: -5, currentRoundThru: 9 } });
    expect(byEvent.golf.standingId).toBe(byEvent.standing.id);
    await expect(golfStandings.findBySportEventParticipants([entry.id])).resolves.toHaveLength(1);
  });

  it('writes many standings all or none: one bad field row leaves every standing as it was', async () => {
    const { golfStandings } = repos();
    const { entry } = await createPopulatedEvent();

    await expect(golfStandings.upsertMany([
      { sportEventParticipantId: entry.id, currentRound: 2, status: 'IN_PROGRESS', asOf: new Date(), eventScoreToPar: -9, eventStrokes: 135, currentRoundThru: 9 },
      { sportEventParticipantId: randomUUID(), currentRound: 2, status: 'IN_PROGRESS', asOf: new Date(), eventScoreToPar: 0, eventStrokes: 144, currentRoundThru: 9 },
    ])).rejects.toBeDefined();

    const [standing] = await golfStandings.findBySportEventParticipants([entry.id]);
    expect(standing.golf.eventScoreToPar).toBe(-2);
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
    await expect(mappings.findByParticipant(ana.id)).resolves.toEqual([expect.objectContaining({ externalId: 'pg-1' })]);
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
    data: { cupName: 'Test Cup', leagueCode: `REPO${suffix.toUpperCase()}`, name: `Repository League ${suffix}`, iconKey: 'TROPHY' },
  });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const squad = await prisma.squad.create({ data: { leagueId: league.id, name: `Repository Squad ${suffix}`, createdBy: user.id } });
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id, seasonYear: 2026, sportEvents: { create: { sportEventId, sequence: 1 } }, name: `Repository Contest ${suffix}`, status: 'OPEN',
      contestFormat: 'ROSTER', selectionType: 'TIERED',
    },
  });
  const entry = await prisma.contestEntry.create({
    data: { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: `Entry ${suffix}`, events: { create: { sportEventId: sportEventId, status: 'SUBMITTED', submittedAt: new Date() } } },
  });
  return { contestId: contest.id, entryId: entry.id };
}
