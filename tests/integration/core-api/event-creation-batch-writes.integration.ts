import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Sport } from '@poolmaster/shared/domain';
import { createSportEventServices } from '../../../packages/core-api/src/modules/events/wiring';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { recordStatements, statementCounts } from '../statement-log';
import { expectDefined } from '../../support/expect-defined';

// Creating, cloning and importing events against real Postgres (#1253): each writes its events,
// their series, rounds and default tiers in a fixed number of queries however many events, and
// answers summaries that match what a read of the events gives. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const PROVIDER_ID = 'integration-test';
const DAY = 24 * 60 * 60 * 1000;

/** A golf tour of its own, with no events. */
async function golfTour() {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  return prisma.sportLeague.create({ data: { sportId: sport.id, name: `Batch Tour ${randomUUID().slice(0, 8)}` } });
}

/** `count` provider events a week apart in `year`, each played Thursday to Sunday. */
function providerSlate(count: number, year: number) {
  return Array.from({ length: count }, (_, index) => {
    const startDate = new Date(Date.UTC(year, 3, 2 + index * 7, 12));
    return {
      externalId: `slate-${randomUUID()}`,
      name: `Open ${index + 1}`,
      venue: `Course ${index + 1}`,
      startDate,
      endDate: new Date(startDate.getTime() + 3 * DAY),
    };
  });
}

describe('Importing a provider\'s year of events (#1253)', () => {
  it('imports any number of events in the same number of queries', async () => {
    const tour = await golfTour();
    const counts = [];
    for (const [year, size] of [[2027, 2], [2028, 6]] as const) {
      const { sportEvents } = createSportEventServices(getAppPrisma());
      const { result: { created, skipped }, statements } = await recordStatements(() => sportEvents.importProviderEventYear({
        sportLeagueId: tour.id, eventYear: year, providerId: PROVIDER_ID, providerEvents: providerSlate(size, year),
      }));
      expect([created.length, skipped.length]).toEqual([size, 0]);
      counts.push(statementCounts(statements));
    }

    expect(counts[1]).toEqual(counts[0]);
  });

  it('creates each event linked to its provider with the rounds its dates imply and the default tiers, answering what a read gives', async () => {
    const tour = await golfTour();
    const slate = providerSlate(2, 2027);
    const { sportEvents } = createSportEventServices(getAppPrisma());

    const { created } = await sportEvents.importProviderEventYear({ sportLeagueId: tour.id, eventYear: 2027, providerId: PROVIDER_ID, providerEvents: slate });

    expect(created.map(({ event }) => [event.name, event.externalId, event.providerId, event.syncScope, event.status, event.rounds])).toEqual(
      slate.map((providerEvent) => [providerEvent.name, providerEvent.externalId, PROVIDER_ID, 'SCORES_ONLY', 'DRAFT', 4]),
    );
    for (const summary of created) {
      expect(summary).toEqual(await sportEvents.requireAdminSummary(summary.event.id));
    }
    const first = expectDefined(created[0]);
    const rounds = await getPrisma().sportEventRound.findMany({ where: { sportEventId: first.event.id }, orderBy: { roundNumber: 'asc' } });
    expect(rounds.map((round) => round.scheduledDate.toISOString().slice(0, 10))).toEqual(['2027-04-02', '2027-04-03', '2027-04-04', '2027-04-05']);
    expect(first).toMatchObject({ tierCount: 6, loadedParticipantCount: 0, adminCounts: { emptyTierLabels: ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Tier 6'], contestCount: 0 } });
  });

  it('skips an event already linked, a series that has an edition that year, and a second event of one name, creating the rest', async () => {
    const tour = await golfTour();
    const [linked, edition, fresh] = providerSlate(3, 2027);
    const { sportEvents } = createSportEventServices(getAppPrisma());
    await sportEvents.importProviderEventYear({ sportLeagueId: tour.id, eventYear: 2027, providerId: PROVIDER_ID, providerEvents: [expectDefined(linked)] });
    await sportEvents.createEvent({ sportLeagueId: tour.id, eventYear: 2027, name: expectDefined(edition).name, startDate: expectDefined(edition).startDate });
    const sameName = { ...expectDefined(fresh), externalId: `slate-${randomUUID()}` };

    const result = await sportEvents.importProviderEventYear({
      sportLeagueId: tour.id, eventYear: 2027, providerId: PROVIDER_ID, providerEvents: [expectDefined(linked), expectDefined(edition), expectDefined(fresh), sameName],
    });

    expect(result.created.map(({ event }) => event.externalId)).toEqual([expectDefined(fresh).externalId]);
    expect(result.skipped).toEqual([
      { externalId: expectDefined(linked).externalId, name: expectDefined(linked).name, reason: 'ALREADY_LINKED' },
      { externalId: expectDefined(edition).externalId, name: expectDefined(edition).name, reason: 'EDITION_EXISTS' },
      { externalId: sameName.externalId, name: sameName.name, reason: 'EDITION_EXISTS' },
    ]);
  });
});

describe('Cloning a year\'s calendar (#1253)', () => {
  it('clones any number of events in the same number of queries, each a draft a year on with its rounds and tiers', async () => {
    const counts = [];
    for (const size of [2, 6]) {
      const tour = await golfTour();
      await createSportEventServices(getAppPrisma()).sportEvents.importProviderEventYear({
        sportLeagueId: tour.id, eventYear: 2027, providerId: PROVIDER_ID, providerEvents: providerSlate(size, 2027),
      });
      const { sportEvents } = createSportEventServices(getAppPrisma());

      const { result: cloned, statements } = await recordStatements(() => sportEvents.cloneEventYear({ sportLeagueId: tour.id, eventYear: 2027 }));

      counts.push(statementCounts(statements));
      expect(cloned.map(({ event }) => [event.eventYear, event.status, event.providerId])).toEqual(cloned.map(() => [2028, 'DRAFT', 'manual-admin']));
      for (const summary of cloned) {
        expect(summary).toEqual(await sportEvents.requireAdminSummary(summary.event.id));
      }
      const rounds = await getPrisma().sportEventRound.count({ where: { sportEventId: { in: cloned.map(({ event }) => event.id) } } });
      expect(rounds).toBe(size * 4);
    }

    expect(counts[1]).toEqual(counts[0]);
  });
});

describe('Creating one event (#1253)', () => {
  it('creates the event with its default rounds and tiers in one insert per table, answering the summary a read of it gives', async () => {
    const tour = await golfTour();
    const { sportEvents } = createSportEventServices(getAppPrisma());

    const { result: created, statements } = await recordStatements(
      () => sportEvents.createEvent({ sportLeagueId: tour.id, eventYear: 2027, name: 'The Batch Classic', startDate: new Date('2027-05-06T12:00:00.000Z') }),
    );

    // One insert per table: the default rounds and tiers go in together, not one at a time.
    expect(statementCounts(statements).filter(([target]) => !target.startsWith('SELECT '))).toEqual([
      ['INSERT event_series', 1], ['INSERT sport_event_rounds', 1], ['INSERT sport_event_tiers', 1], ['INSERT sport_events', 1],
    ]);
    expect(created).toEqual(await sportEvents.requireAdminSummary(created.event.id));
    expect(await getPrisma().sportEventRound.count({ where: { sportEventId: created.event.id } })).toBe(4);
  });

  it('refuses a second edition of a series in a year with 409 EVENT_EDITION_ALREADY_EXISTS', async () => {
    const tour = await golfTour();
    const { sportEvents } = createSportEventServices(getAppPrisma());
    await sportEvents.createEvent({ sportLeagueId: tour.id, eventYear: 2027, name: 'The Batch Classic', startDate: new Date('2027-05-06T12:00:00.000Z') });

    await expect(sportEvents.createEvent({ sportLeagueId: tour.id, eventYear: 2027, name: 'The Batch Classic', startDate: new Date('2027-05-13T12:00:00.000Z') }))
      .rejects.toMatchObject({ code: 'EVENT_EDITION_ALREADY_EXISTS', statusCode: 409 });
  });
});

describe('Editing an event\'s tiers (#1253)', () => {
  const tier = (index: number) => ({ tierKey: `tier-${index}`, label: `Tier ${index}`, tierNumber: index });

  it('saves a tier list in the same number of queries however many tiers stay as they were', async () => {
    const tour = await golfTour();
    const { sportEvents, tiers } = createSportEventServices(getAppPrisma());
    const six = await sportEvents.createEvent({ sportLeagueId: tour.id, eventYear: 2027, name: 'Six Tier Open', startDate: new Date('2027-05-06T12:00:00.000Z') });
    const two = await sportEvents.createEvent({ sportLeagueId: tour.id, eventYear: 2027, name: 'Two Tier Open', startDate: new Date('2027-05-13T12:00:00.000Z') });
    await tiers.replaceTiers({ sportEventId: two.event.id, tiers: [tier(1), tier(2)] });

    const counts = [];
    for (const [event, size] of [[two, 2], [six, 6]] as const) {
      const { statements } = await recordStatements(() => createSportEventServices(getAppPrisma()).tiers.replaceTiers({
        sportEventId: event.event.id,
        tiers: [...Array.from({ length: size }, (_, index) => tier(index + 1)), tier(size + 1)],
      }));
      counts.push(statementCounts(statements));
    }

    expect(counts[1]).toEqual(counts[0]);
  });

  it('reverses, renames, removes and adds tiers in one save, a new tier taking a removed one\'s number and kept tiers keeping their rows', async () => {
    const tour = await golfTour();
    const { sportEvents, tiers } = createSportEventServices(getAppPrisma());
    const created = await sportEvents.createEvent({ sportLeagueId: tour.id, eventYear: 2027, name: 'Shuffle Open', startDate: new Date('2027-05-06T12:00:00.000Z') });
    const before = await getPrisma().sportEventTier.findMany({ where: { sportEventId: created.event.id } });
    const idByKey = new Map(before.map((row) => [row.tierKey, row.id]));

    await tiers.replaceTiers({
      sportEventId: created.event.id,
      tiers: [
        ...[1, 2, 3, 4, 5].map((index) => ({ ...tier(index), tierNumber: 6 - index })),
        { tierKey: 'tier-new', label: 'Long Shots', tierNumber: 6 },
      ].map((definition) => (definition.tierKey === 'tier-1' ? { ...definition, label: 'Favourites' } : definition)),
    });

    const after = await getPrisma().sportEventTier.findMany({ where: { sportEventId: created.event.id }, orderBy: { tierNumber: 'asc' } });
    expect(after.map((row) => [row.tierKey, row.tierNumber, row.label])).toEqual([
      ['tier-5', 1, 'Tier 5'], ['tier-4', 2, 'Tier 4'], ['tier-3', 3, 'Tier 3'], ['tier-2', 4, 'Tier 2'], ['tier-1', 5, 'Favourites'], ['tier-new', 6, 'Long Shots'],
    ]);
    expect(after.filter((row) => row.tierKey !== 'tier-new').every((row) => row.id === idByKey.get(row.tierKey))).toBe(true);
  });
});
