import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { expect } from '@jest/globals';
import { testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { randomUUID } from 'node:crypto';
import { BackgroundJobType, GameSideStatus, MatchStatus, ParticipantStandingStatus, SportEventParticipantStatus, ProviderCode, Sport } from '@poolmaster/shared/domain';
import type { FieldSideWrite, FieldStandingWrite } from '@poolmaster/shared/db';
import {
  PrismaFieldGameRepository,
  PrismaParticipantProviderMappingRepository,
  PrismaParticipantRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventSlotParticipantValuationRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundMatchRepository,
  PrismaSportEventRoundRepository,
  PrismaSportEventSlotTierRepository,
  PrismaBackgroundJobRepository,
} from '../../../packages/core-api/src/adapters';
import { createSportEventParticipantService } from '../../../packages/core-api/src/modules/events/wiring';
import { testDomainEvents } from '../../support/domain-events';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';
import { SportEventAutoReleaseScheduler } from '../../../packages/core-api/src/modules/events/sport-event-auto-release-scheduler';
import {
  cleanupTestData,
  createTestUser,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { findUnindexedScans } from '../index-check';
import { recordStatements, statementShape } from '../statement-log';
import { createRoundRows, createSportEventRow, createTierRows } from '../../support/sport-event-rows';
import { freshEventEdition, mapEventToProvider, fixtureSeasonId } from '../../support/event-edition';
import { standardPricingIn } from '../../support/budget-pricing';
import { tierSetSlot } from '../../support/event-tier-sets';
import { expectDefined } from '../../support/expect-defined';
import { linkTestSlot } from '../../support/test-slots';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { syncLeagueTo } from '../../support/league-sync';
import { participantLeagueId } from '../../support/participant-league';
import { sportRowKeys } from '../../support/sport-rows';
import { sportPlay } from '../../support/sport-play';

// The event-core write ports and the FIELD Game port (#236, #2008) against real Postgres:
// what each write leaves in the tables, that "all or none" is all or none, and that
// removal takes an event's or a field row's children with it. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const TIERS = [
  { tierKey: 'tier-1', tierNumber: 1 },
  { tierKey: 'tier-2', tierNumber: 2 },
];

/** The event's one slot, whose set its tiers and valuations are in (#2044); linked now when it has none. */
function slotOf(event: { id: string }) {
  return tierSetSlot(getPrisma(), event.id);
}

function repos() {
  return {
    events: new PrismaSportEventRepository(getAppPrisma()),
    rounds: new PrismaSportEventRoundRepository(getAppPrisma()),
    field: new PrismaSportEventParticipantRepository(getAppPrisma()),
    tiers: new PrismaSportEventSlotTierRepository(getAppPrisma()),
    valuations: new PrismaSportEventSlotParticipantValuationRepository(getAppPrisma()),
    fieldGames: new PrismaFieldGameRepository(getAppPrisma()),
    participants: new PrismaParticipantRepository(getAppPrisma()),
    mappings: new PrismaParticipantProviderMappingRepository(getAppPrisma()),
  };
}

async function golfSportId(): Promise<string> {
  const sport = await getPrisma().sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF) },
    update: {},
  });
  return sport.id;
}

const ROUND_1_DONE = new Date('2026-06-04T22:00:00.000Z');

/** A golfer's finished round as the stroke-play writer sends it. */
function golferSide(sportEventParticipantId: string, strokes: number, scoreToPar: number): FieldSideWrite {
  return { sportEventParticipantId, score: strokes, scoreToPar, periodsCompleted: 18, position: null, startPosition: null, status: GameSideStatus.FINISHED };
}

/** A golfer's standing once their event is complete. */
function golferStanding(sportEventParticipantId: string, total: number, scoreToPar: number): FieldStandingWrite {
  return { sportEventParticipantId, position: null, displayPosition: null, status: ParticipantStandingStatus.COMPLETE, asOf: new Date(), total, scoreToPar };
}

async function createEvent(name = 'Repository Open', championshipYear?: number) {
  return createSportEventRow(repos().events, {
    ...(await freshEventEdition(getPrisma(), { championshipYear })),
    name,
    venue: 'Harbour Links',
    startDate: new Date('2026-06-04T12:00:00.000Z'),
    endDate: new Date('2026-06-07T12:00:00.000Z'),
    status: 'SCHEDULED',
    rounds: 4,
    autoLifecycleEnabled: true,
  });
}

async function createParticipants(names: string[]) {
  const sportLeagueId = await participantLeagueId(getPrisma(), await golfSportId());
  return Promise.all(names.map((name) => getPrisma().participant.create({
    data: { sportLeagueId, name, participantType: 'INDIVIDUAL' },
  })));
}

/** An event with one scored, standing, valued golfer on its field, two rounds and two tiers. */
async function createPopulatedEvent() {
  const { rounds, field, tiers, valuations, fieldGames } = repos();
  const event = await createEvent();
  const [golfer] = await createParticipants(['Populated Golfer']);
  await createRoundRows(getPrisma(), rounds, event, [
    { roundNumber: 1, scheduledDate: new Date('2026-06-04T12:00:00.000Z') },
    { roundNumber: 2, scheduledDate: new Date('2026-06-05T12:00:00.000Z') },
  ]);
  await createTierRows(tiers, (await slotOf(event)).id, TIERS);
  await field.createMany(event.id, [{ participantId: golfer.id, seedNumber: 1 }]);
  const [entry] = await field.findBySportEvent(event.id);
  const [tier] = await tiers.findBySlot((await slotOf(event)).id);
  await valuations.assignTiers(await slotOf(event), [{ sportEventParticipantId: entry.id, sportEventSlotTierId: tier.id, tierOrderIndex: 1, source: 'MANUAL' }]);
  await fieldGames.applyResults(event.id, {
    games: [{ roundNumber: 1, status: MatchStatus.COMPLETED, completedAt: ROUND_1_DONE, sides: [golferSide(entry.id, 70, -2)] }],
    standings: [golferStanding(entry.id, 70, -2)],
  });
  return { event, entry, golfer };
}

describe('SportEventRepository — writes', () => {
  it('creates an event, finds it by the provider\'s id for it, and clears nullable fields with null but leaves undefined ones alone', async () => {
    const { events } = repos();
    const event = await createEvent();
    const externalId = `repo-${randomUUID()}`;
    await mapEventToProvider(getPrisma(), event.id, { providerId: 'balldontlie', externalId });

    await expect(events.findByProviderRefs('balldontlie', [externalId])).resolves.toMatchObject([{ id: event.id, providerMappings: [{ providerCode: ProviderCode.BALLDONTLIE, providerName: 'BALLDONTLIE', externalId }] }]);
    await expect(events.findByProviderRefs('balldontlie', ['nobody'])).resolves.toEqual([]);
    await expect(events.findByProviderRefs('no-such-provider', [externalId])).resolves.toEqual([]);

    const updated = await events.update(event.id, { venue: null, endDate: null, name: 'Renamed Open', location: undefined });

    expect(updated).toMatchObject({ name: 'Renamed Open', venue: undefined, endDate: undefined, rounds: 4 });
  });

  it('filters by a case-insensitive name substring', async () => {
    const { events } = repos();
    await createEvent('Harbour Classic');
    await createEvent('Desert Open');

    expect((await events.findAll({ q: 'harbour' })).map((row) => row.name)).toEqual(['Harbour Classic']);
  });

  it("lists one Season's events through an index that leads on the Season, not by reading every event", async () => {
    const { events } = repos();
    const thisSeason = await createEvent('Season Open', 2031);
    await createEvent('Last Season Open', 2030);

    const { result, statements } = await recordStatements(() => events.findAll({ sportLeagueSeasonId: thisSeason.sportLeagueSeasonId }));

    expect(result.map((row) => row.id)).toEqual([thisSeason.id]);
    expect(statements.map((statement) => statementShape(statement.sql)).join('\n'))
      .toContain('"public"."sport_events"."sport_league_season_id" = $?');
    await expect(findUnindexedScans(getPrisma(), statements.map(({ sql }) => ({ sql, test: 'findAll by Season' })))).resolves.toEqual([]);
  });

  it('deletes an event that has rounds, tiers and a scored, valued field — which a bare event delete could not', async () => {
    const { events } = repos();
    const { event } = await createPopulatedEvent();

    await events.delete(event.id);

    const prisma = getPrisma();
    await expect(events.findById(event.id)).resolves.toBeNull();
    await expect(prisma.sportEventRound.count({ where: { sportEventId: event.id } })).resolves.toBe(0);
    await expect(prisma.sportEventSlotTier.count({ where: { slot: { sportEventId: event.id } } })).resolves.toBe(0);
    await expect(prisma.sportEventSlotParticipantValuation.count({ where: { sportEventId: event.id } })).resolves.toBe(0);
    await expect(prisma.sportEventParticipant.count({ where: { sportEventId: event.id } })).resolves.toBe(0);
    await expect(prisma.sportEventRoundMatchGameSideResult.count({ where: { game: { sportEventId: event.id } } })).resolves.toBe(0);
    await expect(prisma.sportEventParticipantStanding.count({ where: { sportEventParticipant: { sportEventId: event.id } } })).resolves.toBe(0);
  });

  it('counts tiers per event slot and contests per event, zero where there are none', async () => {
    const { events, tiers } = repos();
    const withTiers = await createEvent('With Tiers');
    const bare = await createEvent('Bare');
    const [tieredSlot, bareSlot] = [await slotOf(withTiers), await slotOf(bare)];
    await createTierRows(tiers, tieredSlot.id, TIERS);
    const fixture = await createContestFixture(withTiers.id);

    expect(await events.countTiers([tieredSlot.id, bareSlot.id])).toEqual(new Map([[tieredSlot.id, 2], [bareSlot.id, 0]]));
    expect(await events.countContests([withTiers.id, bare.id])).toEqual(new Map([[withTiers.id, 1], [bare.id, 0]]));
    expect(fixture.contestId).toBeDefined();
  });

  it('lists, in tier order, the numbers of the tiers no active participant is in — a tier holding only a withdrawn one counts as empty', async () => {
    const { events, tiers, field, valuations } = repos();
    const event = await createEvent('Empty Tiers');
    const bare = await createEvent('No Tiers');
    await createTierRows(tiers, (await slotOf(event)).id, [...TIERS, { tierKey: 'tier-3', tierNumber: 3 }]);
    const [active, withdrawn] = await createParticipants(['Active Golfer', 'Withdrawn Golfer']);
    await field.createMany(event.id, [{ participantId: active.id }, { participantId: withdrawn.id }]);
    await getPrisma().sportEventParticipant.updateMany({ where: { participantId: withdrawn.id }, data: { status: 'WITHDRAWN' } });
    const entries = await field.findBySportEvent(event.id);
    const [tier1, tier2] = await tiers.findBySlot((await slotOf(event)).id);
    await valuations.assignTiers(await slotOf(event), entries.map((entry) => ({
      sportEventParticipantId: entry.id,
      sportEventSlotTierId: entry.participantId === active.id ? tier1.id : tier2.id,
      tierOrderIndex: 1,
      source: 'MANUAL',
    })));

    const [slot, bareSlot] = [await slotOf(event), await slotOf(bare)];
    expect(await events.findEmptyTierNumbers([slot.id, bareSlot.id])).toEqual(new Map([[slot.id, [2, 3]], [bareSlot.id, []]]));
  });

  it('finds the lifecycle scheduler\'s candidates: auto lifecycle on and scheduled, in progress or postponed, linked to a provider or not', async () => {
    const { events } = repos();
    const scheduled = await createEvent('Scheduled');
    const inProgress = await createEvent('In Progress');
    await events.update(inProgress.id, { status: 'IN_PROGRESS' });
    const completed = await createEvent('Completed');
    await events.update(completed.id, { status: 'COMPLETED' });
    const postponed = await createEvent('Postponed');
    await events.update(postponed.id, { status: 'POSTPONED' });
    const manualOverride = await createEvent('Manual Override');
    await events.update(manualOverride.id, { autoLifecycleEnabled: false });
    const linked = await createEvent('Linked');
    await mapEventToProvider(getPrisma(), linked.id, { providerId: 'balldontlie', externalId: `repo-${randomUUID()}` });

    const created = new Set([scheduled.id, inProgress.id, completed.id, postponed.id, manualOverride.id, linked.id]);
    const candidates = (await events.findAutoLifecycleCandidates()).filter((event) => created.has(event.id));

    expect(candidates.map((event) => event.name).sort()).toEqual(['In Progress', 'Linked', 'Postponed', 'Scheduled']);
  });
});

describe('SportEventRoundRepository — writes', () => {
  it('creates every round in one write, keeping each round\'s own end time or none', async () => {
    const { rounds } = repos();
    const event = await createEvent();
    const seasonSlotId = await linkTestSlot(getPrisma(), event);

    await rounds.createMany([
      { sportEventId: event.id, seasonSlotId, roundNumber: 1, scheduledDate: new Date('2026-06-04T12:00:00.000Z'), scheduledEndAt: new Date('2026-06-04T22:00:00.000Z') },
      { sportEventId: event.id, seasonSlotId, roundNumber: 2, scheduledDate: new Date('2026-06-05T12:00:00.000Z') },
    ]);

    const created = await rounds.findBySportEvent(event.id);
    expect(created.map((round) => [round.roundNumber, round.scheduledEndAt ?? null])).toEqual([
      [1, new Date('2026-06-04T22:00:00.000Z')],
      [2, null],
    ]);
  });

  it('reads each round with the slot it is played in, its name and kind from the slot\'s definition', async () => {
    const { rounds } = repos();
    const event = await createEvent();
    const seasonSlotId = await linkTestSlot(getPrisma(), event);
    await rounds.createMany([{ sportEventId: event.id, seasonSlotId, roundNumber: 1, scheduledDate: new Date('2026-06-04T12:00:00.000Z') }]);

    const [round] = await rounds.findBySportEvent(event.id);

    expect(round.slot).toMatchObject({ seasonSlotId, slotKind: expect.any(String), seriesGames: 1, pairing: 'FIXED' });
  });

  it('refuses a round in a slot that is not one of its own event\'s: the composite key keeps every round in its event\'s slots', async () => {
    const { rounds } = repos();
    const [event, other] = [await createEvent('Round Slot Owner'), await createEvent('Round Slot Other')];
    const othersSlotId = await linkTestSlot(getPrisma(), other);
    const { id: othersEventSlotId } = await getPrisma().sportEventSlot.findFirstOrThrow({ where: { sportEventId: other.id }, select: { id: true } });

    await expect(rounds.createMany([{ sportEventId: event.id, seasonSlotId: othersSlotId, roundNumber: 1, scheduledDate: event.startDate }])).rejects.toThrow();
    await expect(getPrisma().sportEventRound.create({
      data: { sportEventId: event.id, sportEventSlotId: othersEventSlotId, roundNumber: 1, scheduledDate: event.startDate },
    })).rejects.toThrow();
    await expect(rounds.findBySportEvent(event.id)).resolves.toEqual([]);
  });

  it('reschedules all or none: an unknown round number leaves every round where it was', async () => {
    const { rounds } = repos();
    const event = await createEvent();
    await createRoundRows(getPrisma(), rounds, event, [{ roundNumber: 1, scheduledDate: new Date('2026-06-04T12:00:00.000Z') }]);

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
    await createRoundRows(getPrisma(), rounds, event, [{ roundNumber: 1, scheduledDate: new Date('2026-06-04T12:00:00.000Z') }]);

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
    await createRoundRows(getPrisma(), rounds, withRounds, [
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
      { participantId: ana.id, seedNumber: 1, status: SportEventParticipantStatus.WITHDRAWN },
      { participantId: ben.id },
    ]);

    const rows = await field.findBySportEvent(event.id);
    expect(rows.map((row) => [row.participantId, row.seedNumber, row.status === SportEventParticipantStatus.ACTIVE])).toEqual([
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

  it('reads events\' links by id, just the id, name, sport league and provider, in a fixed four statements for unsynced leagues (events, their provider ids, Seasons and leagues), leaving out an id with no event', async () => {
    const { events } = repos();
    const [week1, week2] = [await createEvent('Week 1'), await createEvent('Week 2')];

    const { result: links, statements } = await recordStatements(() => events.findLinks([week1.id, week2.id, randomUUID()]));

    expect([...links].sort((left, right) => left.name.localeCompare(right.name))).toEqual([
      { id: week1.id, name: 'Week 1', sportLeagueId: week1.sportLeagueId, providerId: null },
      { id: week2.id, name: 'Week 2', sportLeagueId: week2.sportLeagueId, providerId: null },
    ]);
    expect(statements).toHaveLength(4);
    expect(await events.findLinks([])).toEqual([]);
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

    const slot = await slotOf(event);
    await field.updateMany([{ id: entry.id, updates: { ranking: null, oddsToWin: 12.5 }, valuation: { slot, price: 9.5 } }]);
    await expect(field.updateMany([
      { id: entry.id, updates: { seedNumber: 7 } },
      { id: randomUUID(), updates: { seedNumber: 8 } },
    ])).rejects.toBeDefined();

    const [after] = await field.findBySportEvent(event.id);
    expect(after).toMatchObject({ ranking: undefined, oddsToWin: 12.5, seedNumber: 1 });
    const [valuation] = await valuations.findBySlot((await slotOf(event)).id);
    expect(valuation).toMatchObject({ price: 9.5, priceAssignedSource: 'MANUAL', sportEventSlotTierId: null });
  });

  it('removes a field row with its valuation, standing and scored rounds, and counts picks', async () => {
    const { field } = repos();
    const { event, entry } = await createPopulatedEvent();

    await expect(field.countPicks(entry.id)).resolves.toBe(0);
    await field.delete(entry.id);

    await expect(field.findBySportEvent(event.id)).resolves.toEqual([]);
    await expect(getPrisma().sportEventSlotParticipantValuation.count()).resolves.toBe(0);
    await expect(getPrisma().sportEventParticipantStanding.count()).resolves.toBe(0);
    // Its side in the round's FIELD Game goes with it, its result too; the Game stays.
    await expect(getPrisma().sportEventRoundMatchSide.count({ where: { sportEventId: event.id } })).resolves.toBe(0);
    await expect(getPrisma().sportEventRoundMatchGameSideResult.count({ where: { game: { sportEventId: event.id } } })).resolves.toBe(0);
  });

  it('counts the contest-entry picks made of a field row', async () => {
    const { field } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);
    const fixture = await createContestFixture(event.id);
    await getPrisma().contestEntryPick.create({
      data: { entryId: fixture.entryId, sportEventParticipantId: entry.id, isAutoPicked: false },
    });

    await expect(field.countPicks(entry.id)).resolves.toBe(1);
  });
});

describe('SportEventSlotTierRepository and valuations', () => {
  it('replaces tiers: swaps numbers without a unique clash and moves a removed tier\'s valuations to the named tier', async () => {
    const { tiers, valuations, field } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await createTierRows(tiers, (await slotOf(event)).id, [...TIERS, { tierKey: 'tier-3', tierNumber: 3 }]);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);
    const tier3 = (await tiers.findBySlot((await slotOf(event)).id))[2];
    await valuations.assignTiers(await slotOf(event), [{ sportEventParticipantId: entry.id, sportEventSlotTierId: tier3.id, tierOrderIndex: 4, source: 'AUTO_ODDS' }]);

    await tiers.replace((await slotOf(event)).id, [
      { tierKey: 'tier-1', tierNumber: 2 },
      { tierKey: 'tier-2', tierNumber: 1 },
    ], 'tier-2');

    const after = await tiers.findBySlot((await slotOf(event)).id);
    expect(after.map((tier) => [tier.tierKey, tier.tierNumber])).toEqual([['tier-2', 1], ['tier-1', 2]]);
    const [valuation] = await valuations.findBySlot((await slotOf(event)).id);
    expect(valuation).toMatchObject({ sportEventSlotTierId: after[0].id, tierOrderIndex: null });
    expect(await tiers.countValuations((await slotOf(event)).id)).toEqual(new Map([[after[0].id, 1]]));
  });

  it('moves a removed tier\'s valuations to a tier added in the same save', async () => {
    const { tiers, valuations, field } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await createTierRows(tiers, (await slotOf(event)).id, TIERS);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);
    const [, tier2] = await tiers.findBySlot((await slotOf(event)).id);
    await valuations.assignTiers(await slotOf(event), [{ sportEventParticipantId: entry.id, sportEventSlotTierId: tier2.id, tierOrderIndex: 1, source: 'MANUAL' }]);

    await tiers.replace((await slotOf(event)).id, [TIERS[0], { tierKey: 'tier-late', tierNumber: 2 }], 'tier-late');

    const after = await tiers.findBySlot((await slotOf(event)).id);
    expect(after.map((tier) => [tier.tierKey, tier.tierNumber])).toEqual([['tier-1', 1], ['tier-late', 2]]);
    await expect(valuations.findBySlot((await slotOf(event)).id)).resolves.toEqual([expect.objectContaining({ sportEventSlotTierId: after[1].id, tierOrderIndex: null })]);
  });

  it('leaves a removed tier\'s valuations without a tier or a tier source when no target is named, so release counts them untiered', async () => {
    const { tiers, valuations, field } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await createTierRows(tiers, (await slotOf(event)).id, TIERS);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);
    const [, tier2] = await tiers.findBySlot((await slotOf(event)).id);
    await valuations.assignTiers(await slotOf(event), [{ sportEventParticipantId: entry.id, sportEventSlotTierId: tier2.id, tierOrderIndex: 1, source: 'MANUAL' }]);

    await tiers.replace((await slotOf(event)).id, [TIERS[0]]);

    await expect(valuations.findBySlot((await slotOf(event)).id)).resolves.toEqual([expect.objectContaining({ sportEventSlotTierId: null, tierAssignedSource: null })]);
    await expect(repos().events.countUntieredActiveParticipants([await slotOf(event)])).resolves.toEqual(new Map([[(await slotOf(event)).id, 1]]));
  });

  it('counts the valuations in each of one slot\'s tiers by reading only that slot\'s valuations, not every valuation of every event', async () => {
    const { tiers, valuations, field } = repos();
    const [event, other] = [await createEvent('Counted'), await createEvent('Other')];
    const [ana, ben, cal] = await createParticipants(['Ana', 'Ben', 'Cal']);
    for (const created of [event, other]) await createTierRows(tiers, (await slotOf(created)).id, TIERS);
    await field.createMany(event.id, [{ participantId: ana.id }, { participantId: ben.id }]);
    await field.createMany(other.id, [{ participantId: cal.id }]);
    const [tier1] = await tiers.findBySlot((await slotOf(event)).id);
    const [otherTier1] = await tiers.findBySlot((await slotOf(other)).id);
    const [anaRow, benRow] = await field.findBySportEvent(event.id);
    const [calRow] = await field.findBySportEvent(other.id);
    await valuations.assignTiers(await slotOf(event), [
      { sportEventParticipantId: anaRow.id, sportEventSlotTierId: tier1.id, tierOrderIndex: 1, source: 'MANUAL' },
      { sportEventParticipantId: benRow.id, sportEventSlotTierId: tier1.id, tierOrderIndex: 2, source: 'MANUAL' },
    ]);
    await valuations.assignTiers(await slotOf(other), [
      { sportEventParticipantId: calRow.id, sportEventSlotTierId: otherTier1.id, tierOrderIndex: 1, source: 'MANUAL' },
    ]);

    const countedSlot = await slotOf(event);
    const { result, statements } = await recordStatements(() => tiers.countValuations(countedSlot.id));

    expect(result).toEqual(new Map([[tier1.id, 2]]));
    expect(statements).toHaveLength(1);
    expect(statements.map((statement) => statementShape(statement.sql)).join('\n'))
      .not.toContain('FROM "public"."sport_event_slot_participant_valuations" WHERE 1=1');
    await expect(findUnindexedScans(getPrisma(), statements.map(({ sql }) => ({ sql, test: 'countValuations' })))).resolves.toEqual([]);
  });

  it('reads several slots\' tiers, each in tier order, and their valuations at once, leaving out slots not asked for', async () => {
    const { tiers, valuations, field } = repos();
    const [first, second, other] = [await createEvent('First'), await createEvent('Second'), await createEvent('Other')];
    const [ana, ben, cal] = await createParticipants(['Ana', 'Ben', 'Cal']);
    for (const event of [first, second, other]) await createTierRows(tiers, (await slotOf(event)).id, [TIERS[1], TIERS[0]]);
    await field.createMany(first.id, [{ participantId: ana.id }]);
    await field.createMany(second.id, [{ participantId: ben.id }]);
    await field.createMany(other.id, [{ participantId: cal.id }]);
    const assign = async (event: { id: string }) => {
      const slot = await slotOf(event);
      const [entry] = await field.findBySportEvent(event.id);
      const [tier] = await tiers.findBySlot(slot.id);
      await valuations.assignTiers(slot, [{ sportEventParticipantId: entry.id, sportEventSlotTierId: tier.id, tierOrderIndex: 1, source: 'MANUAL' }]);
      return entry;
    };
    const [anaRow, benRow] = [await assign(first), await assign(second)];
    await assign(other);
    const slotIds = [(await slotOf(first)).id, (await slotOf(second)).id];

    const read = await tiers.findBySlots(slotIds);
    for (const slotId of slotIds) {
      expect(read.filter((tier) => tier.sportEventSlotId === slotId).map((tier) => tier.tierNumber)).toEqual([1, 2]);
    }
    expect(read).toHaveLength(4);
    expect((await valuations.findBySlots(slotIds)).map((row) => row.sportEventParticipantId).sort())
      .toEqual([anaRow.id, benRow.id].sort());
    expect(await tiers.findBySlots([])).toEqual([]);
    expect(await valuations.findBySlots([])).toEqual([]);
  });

  it('sets tier and price independently, each leaving the other in place', async () => {
    const { tiers, valuations, field } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await createTierRows(tiers, (await slotOf(event)).id, TIERS);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);
    const [tier1] = await tiers.findBySlot((await slotOf(event)).id);

    await valuations.assignTiers(await slotOf(event), [{ sportEventParticipantId: entry.id, sportEventSlotTierId: tier1.id, tierOrderIndex: 1, source: 'AUTO_RANKING' }]);
    await valuations.assignSlotPrices({
      slot: await slotOf(event),
      pricing: await standardPricingIn(getPrisma()),
      assignments: [{ sportEventParticipantId: entry.id, price: 15, source: 'AUTO_ODDS' }],
    });

    await expect(valuations.findBySlot((await slotOf(event)).id)).resolves.toEqual([expect.objectContaining({
      sportEventSlotTierId: tier1.id, tierAssignedSource: 'AUTO_RANKING', price: 15, priceAssignedSource: 'AUTO_ODDS',
    })]);
  });

  it('tiers a field and records the tier profile and size on its slot in one write, read back typed (#1844)', async () => {
    const { tiers, valuations, field } = repos();
    const event = await createEvent();
    const [ana, ben] = await createParticipants(['Ana', 'Ben']);
    await createTierRows(tiers, (await slotOf(event)).id, TIERS);
    await field.createMany(event.id, [{ participantId: ana.id }, { participantId: ben.id }]);
    const [first, second] = await field.findBySportEvent(event.id);
    const [tier1] = await tiers.findBySlot((await slotOf(event)).id);
    const profile = await getPrisma().platformTierProfile.findFirstOrThrow({ where: { type: 'EQUAL_GROUPS' }, orderBy: { code: 'asc' } });

    await valuations.assignSlotTiers({
      slot: await slotOf(event),
      tierSettings: { platformTierProfileId: profile.id, tierSize: 1 },
      assignments: [
        { sportEventParticipantId: first.id, sportEventSlotTierId: tier1.id, tierOrderIndex: 1, source: 'AUTO_ODDS' },
        { sportEventParticipantId: second.id, sportEventSlotTierId: null, tierOrderIndex: 2, source: 'AUTO_ODDS' },
      ],
    });

    const [read] = expectDefined((await tiers.findTierSlots([event.id])).get(event.id), 'the event\'s slots');
    expect(read.tierLayout).toMatchObject({ platformTierProfileId: profile.id, type: 'EQUAL_GROUPS', tierSize: 1 });
    await expect(valuations.findBySlot((await slotOf(event)).id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ sportEventParticipantId: first.id, sportEventSlotTierId: tier1.id }),
      expect.objectContaining({ sportEventParticipantId: second.id, sportEventSlotTierId: null, tierAssignedSource: 'AUTO_ODDS' }),
    ]));
  });

  it('counts an active participant with no tier as untiered, but not one auto-tiering left beyond a capped last tier, nor a withdrawn one (#1844)', async () => {
    const { events, tiers, valuations, field } = repos();
    const event = await createEvent();
    const [ana, ben, cal, dee] = await createParticipants(['Ana', 'Ben', 'Cal', 'Dee']);
    await createTierRows(tiers, (await slotOf(event)).id, TIERS);
    await field.createMany(event.id, [
      { participantId: ana.id },
      { participantId: ben.id },
      { participantId: cal.id },
      { participantId: dee.id, status: SportEventParticipantStatus.WITHDRAWN },
    ]);
    const rows = await field.findBySportEvent(event.id);
    const entryOf = (participantId: string) => expectDefined(rows.find((row) => row.participantId === participantId)).id;
    const [tier1] = await tiers.findBySlot((await slotOf(event)).id);
    await valuations.assignTiers(await slotOf(event), [
      { sportEventParticipantId: entryOf(ana.id), sportEventSlotTierId: tier1.id, tierOrderIndex: 1, source: 'AUTO_ODDS' },
      { sportEventParticipantId: entryOf(ben.id), sportEventSlotTierId: null, tierOrderIndex: 2, source: 'AUTO_ODDS' },
    ]);

    await expect(events.countUntieredActiveParticipants([await slotOf(event)])).resolves.toEqual(new Map([[(await slotOf(event)).id, 1]]));
  });
});

// #787: a sport league's first squares round reads onto each of its events, as its period
// layout does; a league without one leaves the event's unset.
describe('The sport league\'s first squares round on the event read', () => {
  it('reads the league\'s squaresFromRound onto its event, and leaves it unset for a league without one', async () => {
    const prisma = getPrisma();
    const { events } = repos();
    const league = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(Sport.GOLF), sportId: await golfSportId(), name: `Squares round league ${randomUUID()}`, squaresFromRound: 3 } });
    try {
      const withRound = await createSportEventRow(events, {
        sportLeagueId: league.id, sportLeagueSeasonId: await fixtureSeasonId(prisma, league.id, 2026),
        name: 'Squares Round Open', startDate: new Date('2026-06-04T12:00:00.000Z'), status: 'SCHEDULED', autoLifecycleEnabled: true,
      });
      const withoutRound = await createEvent();

      expect((await events.findById(withRound.id))?.squaresFromRound).toBe(3);
      expect((await events.findById(withoutRound.id))?.squaresFromRound).toBeUndefined();
    } finally {
      await prisma.sportEvent.deleteMany({ where: { sportLeagueId: league.id } });
      await prisma.sportLeague.delete({ where: { id: league.id } });
    }
  });
});

describe('Budget pricing on the event slot (#93, #2044)', () => {
  it('prices the field and records the pricing values on its slot in one write, read back typed with the profile\'s name', async () => {
    const { tiers, valuations, field } = repos();
    const event = await createEvent();
    const [ana, ben] = await createParticipants(['Ana', 'Ben']);
    await field.createMany(event.id, [{ participantId: ana.id }, { participantId: ben.id }]);
    const [first, second] = await field.findBySportEvent(event.id);

    await valuations.assignSlotPrices({
      slot: await slotOf(event),
      pricing: await standardPricingIn(getPrisma()),
      assignments: [
        { sportEventParticipantId: first.id, price: 12000, source: 'AUTO_RANKING' },
        { sportEventParticipantId: second.id, price: 6000, source: 'AUTO_RANKING' },
      ],
    });

    const [read] = expectDefined((await tiers.findTierSlots([event.id])).get(event.id), 'the event\'s slots');
    expect(read.pricing).toEqual(await standardPricingIn(getPrisma()));
    expect((await valuations.findBySlot((await slotOf(event)).id)).map((row) => row.price)).toEqual(expect.arrayContaining([12000, 6000]));
  });

  it('writes neither the prices nor the slot\'s pricing values when one price fails', async () => {
    const { tiers, valuations, field } = repos();
    const event = await createEvent();
    const [ana] = await createParticipants(['Ana']);
    await field.createMany(event.id, [{ participantId: ana.id }]);
    const [entry] = await field.findBySportEvent(event.id);

    await expect(valuations.assignSlotPrices({
      slot: await slotOf(event),
      pricing: await standardPricingIn(getPrisma()),
      assignments: [
        { sportEventParticipantId: entry.id, price: 12000, source: 'AUTO_RANKING' },
        { sportEventParticipantId: randomUUID(), price: 6000, source: 'AUTO_RANKING' },
      ],
    })).rejects.toBeDefined();

    const [read] = expectDefined((await tiers.findTierSlots([event.id])).get(event.id), 'the event\'s slots');
    expect(read.pricing).toBeNull();
    await expect(valuations.findBySlot((await slotOf(event)).id)).resolves.toEqual([]);
  });

  it('counts the active golfers with no price, skipping withdrawn ones and ones priced manually', async () => {
    const { events, valuations, field } = repos();
    const event = await createEvent();
    const [ana, ben, cal, dee] = await createParticipants(['Ana', 'Ben', 'Cal', 'Dee']);
    await field.createMany(event.id, [
      { participantId: ana.id },
      { participantId: ben.id },
      { participantId: cal.id },
      { participantId: dee.id, status: SportEventParticipantStatus.WITHDRAWN },
    ]);
    const rows = await field.findBySportEvent(event.id);
    const priced = expectDefined(rows.find((row) => row.participantId === ana.id));
    await valuations.assignSlotPrices({
      slot: await slotOf(event),
      pricing: await standardPricingIn(getPrisma()),
      assignments: [{ sportEventParticipantId: priced.id, price: 9000, source: 'MANUAL' }],
    });

    await expect(events.countUnpricedActiveParticipants([await slotOf(event)])).resolves.toEqual(new Map([[(await slotOf(event)).id, 2]]));
  });
});

describe('FIELD Game repository (#2008)', () => {
  it('writes a golfer\'s round as their side in the round\'s FIELD Game, created with its first result, and rewrites it in place', async () => {
    const { fieldGames } = repos();
    const { event, entry } = await createPopulatedEvent();

    await expect(fieldGames.findResults(event.id)).resolves.toEqual([
      expect.objectContaining({ sportEventParticipantId: entry.id, roundNumber: 1, gameStatus: MatchStatus.COMPLETED, score: 70, scoreToPar: -2, periodsCompleted: 18, status: GameSideStatus.FINISHED }),
    ]);
    const game = await getPrisma().sportEventRoundMatchGame.findFirstOrThrow({ where: { sportEventId: event.id }, include: { match: true } });
    expect(game).toMatchObject({ gameNumber: 1, status: MatchStatus.COMPLETED, completedAt: ROUND_1_DONE, match: { matchNumber: 1, status: MatchStatus.COMPLETED } });

    await fieldGames.applyResults(event.id, {
      games: [{ roundNumber: 1, status: MatchStatus.COMPLETED, completedAt: ROUND_1_DONE, sides: [golferSide(entry.id, 69, -3)] }],
      standings: [],
    });

    await expect(getPrisma().sportEventRoundMatchSide.count({ where: { sportEventId: event.id } })).resolves.toBe(1);
    await expect(getPrisma().sportEventRoundMatchGameSideResult.count({ where: { game: { sportEventId: event.id } } })).resolves.toBe(1);
    await expect(fieldGames.findResults(event.id)).resolves.toEqual([expect.objectContaining({ score: 69, scoreToPar: -3 })]);
  });

  it('gives a golfer new to a round the next side number, and keeps the sides of golfers the write does not name', async () => {
    const { fieldGames, field } = repos();
    const { event, entry } = await createPopulatedEvent();
    const [second] = await createParticipants(['Second Golfer']);
    await field.createMany(event.id, [{ participantId: second.id, seedNumber: 2 }]);
    const secondEntry = expectDefined((await field.findBySportEvent(event.id)).find((row) => row.participantId === second.id));

    await fieldGames.applyResults(event.id, {
      games: [{ roundNumber: 1, status: MatchStatus.COMPLETED, completedAt: ROUND_1_DONE, sides: [golferSide(secondEntry.id, 72, 0)] }],
      standings: [],
    });

    const sides = await getPrisma().sportEventRoundMatchSide.findMany({ where: { sportEventId: event.id }, orderBy: { sideNumber: 'asc' } });
    expect(sides.map((side) => [side.sideNumber, side.sportEventParticipantId])).toEqual([[1, entry.id], [2, secondEntry.id]]);
    expect((await fieldGames.findResults(event.id)).map((result) => result.score).sort((left, right) => (left ?? 0) - (right ?? 0))).toEqual([70, 72]);
  });

  it('writes several rounds in one call, reading them back by round, and a round still being played as IN_PROGRESS with no completion time', async () => {
    const { fieldGames } = repos();
    const { event, entry } = await createPopulatedEvent();

    await fieldGames.applyResults(event.id, {
      games: [
        { roundNumber: 2, status: MatchStatus.IN_PROGRESS, completedAt: null, sides: [{ ...golferSide(entry.id, 33, -3), periodsCompleted: 9, status: null }] },
        { roundNumber: 1, status: MatchStatus.COMPLETED, completedAt: ROUND_1_DONE, sides: [golferSide(entry.id, 69, -3)] },
      ],
      standings: [],
    });

    expect((await fieldGames.findResults(event.id)).map((result) => [result.roundNumber, result.gameStatus, result.score, result.periodsCompleted, result.status]))
      .toEqual([[1, MatchStatus.COMPLETED, 69, 18, GameSideStatus.FINISHED], [2, MatchStatus.IN_PROGRESS, 33, 9, null]]);
  });

  it('writes nothing when one field row in the write is unknown: results, Games and standings stay as they were', async () => {
    const { fieldGames } = repos();
    const { event, entry } = await createPopulatedEvent();

    await expect(fieldGames.applyResults(event.id, {
      games: [{ roundNumber: 2, status: MatchStatus.COMPLETED, completedAt: null, sides: [golferSide(entry.id, 72, 0), golferSide(randomUUID(), 72, 0)] }],
      standings: [golferStanding(entry.id, 142, -2)],
    })).rejects.toBeDefined();

    expect((await fieldGames.findResults(event.id)).map((result) => result.roundNumber)).toEqual([1]);
    await expect(getPrisma().sportEventRoundMatch.count({ where: { sportEventId: event.id } })).resolves.toBe(1);
    await expect(fieldGames.findStandings(event.id)).resolves.toEqual([expect.objectContaining({ total: 70, scoreToPar: -2 })]);
  });

  it('keeps a golf round\'s FIELD match out of the event\'s head-to-head matches, so a golfer with a round is no bracket\'s and leaves the field with it', async () => {
    const { event, entry } = await createPopulatedEvent();

    await expect(new PrismaSportEventRoundMatchRepository(getAppPrisma()).findBySportEvent(event.id)).resolves.toEqual([]);
    await createSportEventParticipantService(getAppPrisma(), testDomainEvents()).removeParticipant(event.id, entry.id);

    await expect(repos().field.findBySportEvent(event.id)).resolves.toEqual([]);
  });

  it('refuses a round the event does not have, naming it', async () => {
    const { fieldGames } = repos();
    const { event, entry } = await createPopulatedEvent();

    await expect(fieldGames.applyResults(event.id, {
      games: [{ roundNumber: 7, status: MatchStatus.COMPLETED, completedAt: null, sides: [golferSide(entry.id, 72, 0)] }],
      standings: [],
    })).rejects.toThrow(`Sport event ${event.id} has no round 7 to hold its results.`);
  });

  it('rewrites a standing with its totals and rank, keeping its id, and reads every standing of the event', async () => {
    const { fieldGames } = repos();
    const { event, entry } = await createPopulatedEvent();
    const [before] = await fieldGames.findStandings(event.id);

    await fieldGames.applyResults(event.id, {
      games: [],
      standings: [{ ...golferStanding(entry.id, 139, -5), status: ParticipantStandingStatus.ACTIVE, position: 1, displayPosition: '1' }],
    });

    await expect(fieldGames.findStandings(event.id)).resolves.toEqual([
      { id: expectDefined(before).id, sportEventParticipantId: entry.id, position: 1, displayPosition: '1', status: ParticipantStandingStatus.ACTIVE, asOf: expect.any(Date), total: 139, scoreToPar: -5 },
    ]);
  });
});

describe('Participant and provider-mapping repositories — additions', () => {
  it('finds participants by ids, and provider mappings by participants and by a provider\'s identifiers within a sport league or a sport, none in another sport', async () => {
    const { participants, mappings } = repos();
    const [ana] = await createParticipants(['Ana']);
    await getPrisma().participantProviderMapping.create({
      data: { participantId: ana.id, sportLeagueId: ana.sportLeagueId, providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL', externalId: 'pg-1' },
    });

    await expect(participants.findByIds([ana.id, randomUUID()])).resolves.toEqual([expect.objectContaining({ id: ana.id })]);
    await expect(mappings.findByParticipant(ana.id)).resolves.toEqual([expect.objectContaining({ externalId: 'pg-1' })]);
    await expect(mappings.findByProviderExternalIds(ProviderCode.BALLDONTLIE, { sportLeagueId: ana.sportLeagueId }, ['pg-1', 'pg-2'])).resolves.toEqual([
      expect.objectContaining({ participantId: ana.id }),
    ]);
    await expect(mappings.findByProviderExternalIds(ProviderCode.BALLDONTLIE, { sport: Sport.GOLF }, ['pg-1'])).resolves.toEqual([
      expect.objectContaining({ participantId: ana.id }),
    ]);
    await expect(mappings.findByProviderExternalIds(ProviderCode.BALLDONTLIE, { sport: Sport.TENNIS }, ['pg-1'])).resolves.toEqual([]);
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

describe('SportEventRepository — automatic release reads (#1823)', () => {
  const NOW = new Date('2026-06-01T12:00:00.000Z');
  const DAY_MS = 24 * 60 * 60 * 1000;
  const LEAGUE_PREFIX = 'Auto Release Tour';

  // A setup pins its sport league past cleanupTestData, and a sweep's jobs outlive the test.
  afterEach(async () => {
    await getPrisma().contestConfigTemplate.deleteMany({ where: { sportLeague: { name: { startsWith: LEAGUE_PREFIX } } } });
    await getPrisma().backgroundJob.deleteMany({ where: { type: BackgroundJobType.RELEASE_SPORT_EVENT } });
  });

  function sweeper() {
    const jobs = new PrismaBackgroundJobRepository(getAppPrisma());
    return {
      jobs,
      scheduler: new SportEventAutoReleaseScheduler({
        sportEvents: repos().events,
        jobs: new BackgroundJobQueue({ jobs, currentStart: testCurrentJobStart }),
        jobLock: { runExclusive: async (_key, work) => { await work(); return true; } },
        now: () => NOW,
      }),
    };
  }

  const releaseJobs = () => getPrisma().backgroundJob.findMany({ where: { type: BackgroundJobType.RELEASE_SPORT_EVENT }, orderBy: { createdAt: 'asc' } });

  /** A golf sport league of its own, synced from BALLDONTLIE's PGA TOUR unless `synced` is false, with this release window. */
  async function syncedLeague(synced: boolean, autoReleaseDaysBeforeStart: number | null = 7) {
    const league = await getPrisma().sportLeague.create({
      data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(getPrisma())), ...sportPlay(Sport.GOLF), sportId: await golfSportId(), name: `${LEAGUE_PREFIX} ${randomUUID()}`, autoReleaseDaysBeforeStart },
    });
    if (synced) await syncLeagueTo(getPrisma(), league.id, 'pga');
    return league;
  }

  /** A draft in the league, kept under BALLDONTLIE's id for it as a sync creates one unless `linked` is false. */
  async function draftIn(sportLeagueId: string, daysAhead: number, status: 'DRAFT' | 'SCHEDULED' = 'DRAFT', linked = true) {
    return createSportEventRow(repos().events, {
      sportLeagueId,
      sportLeagueSeasonId: await fixtureSeasonId(getPrisma(), sportLeagueId, 2026),
      ...(linked && { providerRef: { providerId: 'balldontlie', externalId: `auto-${randomUUID()}` } }),
      name: 'Auto Release Open',
      startDate: new Date(NOW.getTime() + daysAhead * DAY_MS),
      status,
      autoLifecycleEnabled: true,
    });
  }

  it('finds the drafts of synced leagues with automatic release on that start by the horizon, leaving out test events, with each league\'s window and sync provider, in a fixed indexed statement count', async () => {
    const synced = await syncedLeague(true, 5);
    const unsynced = await syncedLeague(false);
    const off = await syncedLeague(true, null);
    const soon = await draftIn(synced.id, 3);
    const later = await draftIn(synced.id, 20);
    await draftIn(synced.id, 40);
    await draftIn(synced.id, -1);
    await draftIn(synced.id, 3, 'SCHEDULED');
    const unlinked = await draftIn(synced.id, 4, 'DRAFT', false);
    await linkTestSlot(getPrisma(), await draftIn(synced.id, 4, 'DRAFT', false));
    await draftIn(unsynced.id, 3, 'DRAFT', false);
    await draftIn(off.id, 3);

    const { result, statements } = await recordStatements(() => repos().events.findAutoReleaseCandidates(NOW, new Date(NOW.getTime() + 30 * DAY_MS)));

    expect(result).toEqual([
      { id: soon.id, startDate: soon.startDate, syncProviderId: 'balldontlie', autoReleaseDaysBeforeStart: 5 },
      { id: unlinked.id, startDate: unlinked.startDate, syncProviderId: 'balldontlie', autoReleaseDaysBeforeStart: 5 },
      { id: later.id, startDate: later.startDate, syncProviderId: 'balldontlie', autoReleaseDaysBeforeStart: 5 },
    ]);
    // The events (test events left out in the same read), then their Seasons, leagues, selected
    // mappings, provider leagues and providers in one read each, however many events there are.
    expect(statements).toHaveLength(6);
    await expect(findUnindexedScans(getPrisma(), statements.map(({ sql }) => ({ sql, test: 'findAutoReleaseCandidates' })))).resolves.toEqual([]);
  });

  it('counts an event\'s rounds, the active setups its league offers and the active tiered or budget ones over its own slot, in three statements', async () => {
    const league = await syncedLeague(true);
    const event = await draftIn(league.id, 3);
    const { rounds } = repos();
    await createRoundRows(getPrisma(), rounds, event, [{ roundNumber: 1, scheduledDate: event.startDate }, { roundNumber: 2, scheduledDate: event.startDate }]);
    const template = { coverageMode: 'ONE_SLOT', contestFormat: 'ROSTER', selectionType: 'TIERED', name: 'Setup', description: 'Setup', sortOrder: 1, configJson: {} } as const;
    await getPrisma().contestConfigTemplate.createMany({
      data: [
        { ...template, sportLeagueId: league.id, templateKey: `own-${randomUUID()}` },
        { ...template, sportLeagueId: league.id, templateKey: `off-${randomUUID()}`, active: false },
      ],
    });

    const { result, statements } = await recordStatements(() => repos().events.findReleaseFacts({ id: event.id, sportLeagueId: league.id }));

    expect(result.scheduledRoundCount).toBe(2);
    // Its own active setup; the retired one is not counted.
    expect(result.contestSetupCount).toBe(1);
    // Neither covers the event's slot, so neither is one its tiers and prices serve.
    expect(result.rosterSetupCount).toBe(0);
    expect(statements).toHaveLength(3);

    // Tiered over the event's slot counts; a pick'em over it does not.
    const { seasonSlot } = await getPrisma().sportEventSlot.findFirstOrThrow({ where: { sportEventId: event.id }, select: { seasonSlot: { select: { sportLeagueCompetitionSlotId: true } } } });
    const covering = await getPrisma().contestConfigTemplate.findFirstOrThrow({ where: { sportLeagueId: league.id, active: true }, select: { id: true } });
    const pickEm = await getPrisma().contestConfigTemplate.create({ data: { ...template, contestFormat: 'PREDICTION', selectionType: 'PICK_EM', sportLeagueId: league.id, templateKey: `pick-${randomUUID()}` } });
    await getPrisma().contestConfigTemplateSlot.createMany({
      data: [covering.id, pickEm.id].map((templateId) => ({ sportLeagueId: league.id, templateId, sportLeagueCompetitionSlotId: seasonSlot.sportLeagueCompetitionSlotId })),
    });
    expect((await repos().events.findReleaseFacts({ id: event.id, sportLeagueId: league.id })).rosterSetupCount).toBe(1);
  });

  it('sweeps 20 events in its window in the same statements as 2: one candidates read and one insert of every job', async () => {
    const league = await syncedLeague(true);
    const sweep = async () => (await recordStatements(() => sweeper().scheduler.runSweep())).statements;
    await Promise.all([1, 2].map((day) => draftIn(league.id, day)));
    const small = await sweep();
    await getPrisma().backgroundJob.deleteMany({ where: { type: BackgroundJobType.RELEASE_SPORT_EVENT } });
    await Promise.all(Array.from({ length: 18 }, (_, index) => draftIn(league.id, 1 + (index % 6))));

    const large = await sweep();

    expect(await releaseJobs()).toHaveLength(20);
    // The insert grows its VALUES list, never its statement count.
    expect(large).toHaveLength(small.length);
    expect(large.filter(({ sql }) => sql.startsWith('INSERT'))).toHaveLength(1);
  });

  it('queues one job per event, scoped to that event, however often it sweeps, until a worker claims it, then the next sweep queues a fresh try', async () => {
    const league = await syncedLeague(true);
    const event = await draftIn(league.id, 3);
    const { scheduler, jobs } = sweeper();

    await scheduler.runSweep();
    await scheduler.runSweep();
    expect(await releaseJobs()).toHaveLength(1);

    // A job is due from when it was written, on the real clock.
    const claimedAt = new Date();
    await jobs.claimDue({ now: claimedAt, limit: 5, leaseUntil: new Date(claimedAt.getTime() + 5 * 60 * 1000) });
    await scheduler.runSweep();

    const queued = await releaseJobs();
    expect(queued).toHaveLength(2);
    expect(queued.map((job) => job.payload)).toEqual([{ sportEventId: event.id, trigger: 'SCHEDULE' }, { sportEventId: event.id, trigger: 'SCHEDULE' }]);
    // Each job is scoped to its event, so Activity finds it on the event and on its league.
    expect(queued.map((job) => job.sportEventId)).toEqual([event.id, event.id]);
  });

});
