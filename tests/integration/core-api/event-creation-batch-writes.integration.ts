import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ProviderCode, Sport } from '@poolmaster/shared/domain';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests, integrationSportEventServices } from '../helpers';
import { recordStatements, statementCounts } from '../statement-log';
import { expectDefined } from '../../support/expect-defined';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { sportRowKeys } from '../../support/sport-rows';
import { fixtureSeasonId, withCurrentSeason } from '../../support/event-edition';
import { sportPlay } from '../../support/sport-play';
import { testSlotId } from '../../support/test-slots';
import { syncLeagueTo } from '../../support/league-sync';
import { nameSlotDefinitionFor, syncSlotsFor } from '../../support/sync-slots';

// Creating and importing events against real Postgres (#1253): each writes its events,
// their series, rounds and default tiers in a fixed number of queries however many events, and
// answers summaries that match what a read of the events gives. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** The provider the tour is synced from, under whose ids its imported events are kept (#2004). */
const PROVIDER_ID = 'balldontlie';
const DAY = 24 * 60 * 60 * 1000;

/**
 * A golf tour of its own synced from BALLDONTLIE's PGA TOUR, with no events, whose current Season
 * is 2087's: a new event goes in it (#2003).
 */
async function golfTour() {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF), tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const tour = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Batch Tour ${randomUUID().slice(0, 8)}` } });
  await withCurrentSeason(prisma, tour.id, 2087);
  const sportLeagueProviderMappingId = await syncLeagueTo(prisma, tour.id, 'pga');
  return { ...tour, sportLeagueProviderMappingId };
}

/** A synced, template-listed slot in the Season for each provider event, mapped by the event's code (#2005). */
async function slotsFor(tour: { id: string; sportLeagueProviderMappingId: string }, sportLeagueSeasonId: string, slate: ReadonlyArray<{ providerSlots: ReadonlyArray<{ code: string }> }>): Promise<string[]> {
  const ids: string[] = [];
  for (const play of slate.flatMap((event) => event.providerSlots)) {
    ids.push(...await syncSlotsFor(getPrisma(), { sportLeagueId: tour.id, sportLeagueProviderMappingId: tour.sportLeagueProviderMappingId, code: play.code, seasonIds: [sportLeagueSeasonId] }));
  }
  return ids;
}

/** `count` provider events a week apart in `year`, each played Thursday to Sunday. */
function providerSlate(count: number, year: number) {
  return Array.from({ length: count }, (_, index) => {
    const startDate = new Date(Date.UTC(year, 3, 2 + index * 7, 12));
    const endDate = new Date(startDate.getTime() + 3 * DAY);
    const externalId = `slate-${randomUUID()}`;
    return {
      externalId,
      name: `Open ${index + 1}`,
      venue: `Course ${index + 1}`,
      startDate,
      endDate,
      providerSlots: [{ code: externalId, startsAt: startDate, endsAt: endDate }],
    };
  });
}

describe('Importing a provider\'s Season of events (#1253, #2003)', () => {
  it('imports any number of events in the same number of queries', async () => {
    const tour = await golfTour();
    const counts = [];
    for (const [year, size] of [[2087, 2], [2088, 6]] as const) {
      const { sportEvents } = integrationSportEventServices();
      const sportLeagueSeasonId = await fixtureSeasonId(getPrisma(), tour.id, year);
      const slate = providerSlate(size, year);
      await slotsFor(tour, sportLeagueSeasonId, slate);
      const { result: { created, skipped }, statements } = await recordStatements(() => sportEvents.importProviderSeason({
        sportLeagueId: tour.id, sportLeagueSeasonId, providerId: PROVIDER_ID, sportLeagueProviderMappingId: tour.sportLeagueProviderMappingId, providerEvents: slate,
      }));
      expect([created.length, skipped.length]).toEqual([size, 0]);
      counts.push(statementCounts(statements));
    }

    // One read of the Season's slots with their mappings and template coverage, the events and
    // their slots in one insert each, and the slot links and dates in one transaction. Each slot
    // whose games moved is one update with its own dates: every slot on a Season's first sync, then
    // only those the provider reschedules.
    const slotUpdates = (count: ReadonlyArray<readonly [string, number]>) => count.find(([statement]) => statement === 'UPDATE sport_league_season_competition_slots')?.[1];
    expect([slotUpdates(counts[0]), slotUpdates(counts[1])]).toEqual([2, 6]);
    const others = (count: ReadonlyArray<readonly [string, number]>) => count.filter(([statement]) => statement !== 'UPDATE sport_league_season_competition_slots');
    expect(others(counts[1])).toEqual(others(counts[0]));
  });

  it('places any number of tournaments by name in the same number of queries: one read of the league\'s name patterns, one write of the new slots and links, one re-read of the slots (#2011)', async () => {
    const tour = await golfTour();
    const counts = [];
    for (const [year, size] of [[2087, 2], [2088, 6]] as const) {
      const { sportEvents } = integrationSportEventServices();
      const sportLeagueSeasonId = await fixtureSeasonId(getPrisma(), tour.id, year);
      // Each tournament's id names no slot: its name is the only key the feed gives.
      const slate = providerSlate(size, year).map((event) => ({ ...event, name: `${event.name} ${randomUUID().slice(0, 8)} presented by Sponsor` }));
      for (const event of slate) {
        await nameSlotDefinitionFor(getPrisma(), {
          sportLeagueId: tour.id, sportLeagueProviderMappingId: tour.sportLeagueProviderMappingId, pattern: event.name.replace(/ presented by Sponsor$/u, '').toLowerCase(), seasonIds: [sportLeagueSeasonId],
        });
      }
      const { result: { created, unplacedNames }, statements } = await recordStatements(() => sportEvents.importProviderSeason({
        sportLeagueId: tour.id, sportLeagueSeasonId, providerId: PROVIDER_ID, sportLeagueProviderMappingId: tour.sportLeagueProviderMappingId, providerEvents: slate,
      }));
      expect([created.length, unplacedNames.length]).toEqual([size, 0]);
      expect(created.every((summary) => summary.slots.length === 1)).toBe(true);
      counts.push(statementCounts(statements));
    }

    // Every new slot takes its tournament's dates, one update each; nothing else grows with the slate.
    const others = (count: ReadonlyArray<readonly [string, number]>) => count.filter(([statement]) => statement !== 'UPDATE sport_league_season_competition_slots');
    expect(others(counts[1])).toEqual(others(counts[0]));
  });

  it('creates each event linked to its provider with the rounds its dates imply and the default tiers, answering what a read gives', async () => {
    const tour = await golfTour();
    const slate = providerSlate(2, 2087);
    const { sportEvents } = integrationSportEventServices();
    const sportLeagueSeasonId = await fixtureSeasonId(getPrisma(), tour.id, 2087);
    await slotsFor(tour, sportLeagueSeasonId, slate);

    const { created } = await sportEvents.importProviderSeason({ sportLeagueId: tour.id, sportLeagueSeasonId, providerId: PROVIDER_ID, sportLeagueProviderMappingId: tour.sportLeagueProviderMappingId, providerEvents: slate });

    expect(created.map(({ event }) => [event.name, event.providerMappings, event.status, event.rounds])).toEqual(
      slate.map((providerEvent) => [providerEvent.name, [{ providerCode: ProviderCode.BALLDONTLIE, providerName: 'BALLDONTLIE', externalId: providerEvent.externalId }], 'DRAFT', 4]),
    );
    for (const summary of created) {
      expect(summary).toEqual(await sportEvents.requireAdminSummary(summary.event.id));
    }
    const first = expectDefined(created[0]);
    const rounds = await getPrisma().sportEventRound.findMany({ where: { sportEventId: first.event.id }, orderBy: { roundNumber: 'asc' } });
    expect(rounds.map((round) => round.scheduledDate.toISOString().slice(0, 10))).toEqual(['2087-04-02', '2087-04-03', '2087-04-04', '2087-04-05']);
    expect(first).toMatchObject({ tierCount: 6, participantCount: 0, adminCounts: { emptyTierNumbers: [1, 2, 3, 4, 5, 6], contestCount: 0 } });
  });

  it('skips an event already linked, and creates a provider event whose name a hand-made event of the Season shares: events are told apart by feed id, never by name', async () => {
    const tour = await golfTour();
    const [linked, fresh] = providerSlate(2, 2087);
    const { sportEvents } = integrationSportEventServices();
    const sportLeagueSeasonId = await fixtureSeasonId(getPrisma(), tour.id, 2087);
    await slotsFor(tour, sportLeagueSeasonId, [expectDefined(linked), expectDefined(fresh)]);
    await sportEvents.importProviderSeason({ sportLeagueId: tour.id, sportLeagueSeasonId, providerId: PROVIDER_ID, sportLeagueProviderMappingId: tour.sportLeagueProviderMappingId, providerEvents: [expectDefined(linked)] });
    await sportEvents.createEvent({ seasonSlotIds: [await testSlotId(getPrisma(), tour.id, expectDefined(fresh).startDate)], name: expectDefined(fresh).name });

    const result = await sportEvents.importProviderSeason({ sportLeagueId: tour.id, sportLeagueSeasonId, providerId: PROVIDER_ID, sportLeagueProviderMappingId: tour.sportLeagueProviderMappingId, providerEvents: [expectDefined(linked), expectDefined(fresh)] });

    expect(result.created.map(({ event }) => event.providerMappings.map((mapping) => mapping.externalId))).toEqual([[expectDefined(fresh).externalId]]);
    expect(result.skipped).toEqual([{ externalId: expectDefined(linked).externalId, name: expectDefined(linked).name, reason: 'ALREADY_LINKED' }]);
  });
});

describe('Creating one event (#1253)', () => {
  it('creates a test event on its test slot with its default rounds and tiers in one insert per table, answering the summary a read of it gives', async () => {
    const tour = await golfTour();
    const { sportEvents } = integrationSportEventServices();

    const seasonSlotId = await testSlotId(getPrisma(), tour.id, new Date('2087-05-06T12:00:00.000Z'));

    const { result: created, statements } = await recordStatements(
      () => sportEvents.createEvent({ seasonSlotIds: [seasonSlotId], name: 'The Batch Classic' }),
    );

    // One insert per table: the default rounds and tiers go in together, not one at a time; and
    // every read is pinned too, so an added read shows. The league's tier profile is one read (#1844),
    // with its sources and its ranges one read each (#2160).
    // The tour is synced: its selected mapping, provider league and provider are read with the
    // league and again with the event read back, beside the event's own provider ids (#2004). The
    // test slot is read once with its definition and any event on it, and linked in one insert. The
    // event read back carries the slot definitions it covers (#2010), a second slot read #2089
    // folds into the summary's; the definitions' competitions and phases once each (#2153). No
    // series is found or created (#2010). The rounds go in the event's slot, whose event slot row is
    // read once for every round, and the slots are read once together, with their events (#2006).
    expect(statementCounts(statements)).toEqual([
      ['INSERT sport_event_rounds', 1], ['INSERT sport_event_slots', 1], ['INSERT sport_event_tiers', 1], ['INSERT sport_events', 1],
      ['SELECT platform_tier_profile_ranges', 1], ['SELECT platform_tier_profile_sources', 1],
      ['SELECT platform_tier_profiles', 1], ['SELECT provider_leagues', 2], ['SELECT providers', 2],
      ['SELECT sport_event_provider_mappings', 1], ['SELECT sport_event_slots', 3], ['SELECT sport_events', 1], ['SELECT sport_league_competition_slots', 3],
      ['SELECT sport_league_competitions', 1], ['SELECT sport_league_phases', 1], ['SELECT sport_league_provider_mappings', 2], ['SELECT sport_league_season_competition_slots', 3],
      ['SELECT sport_league_seasons', 1], ['SELECT sport_leagues', 2], ['SELECT sports', 2],
    ]);
    expect(created).toEqual(await sportEvents.requireAdminSummary(created.event.id));
    expect(await getPrisma().sportEventRound.count({ where: { sportEventId: created.event.id } })).toBe(4);
  });

  it('creates a second event of the same name in a Season: nothing refuses a name twice, as no event is identified by its name', async () => {
    const tour = await golfTour();
    const { sportEvents } = integrationSportEventServices();
    const first = await sportEvents.createEvent({ seasonSlotIds: [await testSlotId(getPrisma(), tour.id, new Date('2087-05-06T12:00:00.000Z'))], name: 'The Batch Classic' });

    const second = await sportEvents.createEvent({ seasonSlotIds: [await testSlotId(getPrisma(), tour.id, new Date('2087-05-13T12:00:00.000Z'))], name: 'The Batch Classic' });

    expect(second.event.id).not.toBe(first.event.id);
    expect(second.event.sportLeagueSeasonId).toBe(first.event.sportLeagueSeasonId);
  });
});

describe('Editing an event\'s tiers (#1253)', () => {
  const tier = (index: number) => ({ tierKey: `tier-${index}`, tierNumber: index });

  it('saves a tier list in the same number of queries however many tiers stay as they were', async () => {
    const tour = await golfTour();
    const { sportEvents, tiers } = integrationSportEventServices();
    const six = await sportEvents.createEvent({ seasonSlotIds: [await testSlotId(getPrisma(), tour.id, new Date('2087-05-06T12:00:00.000Z'))], name: 'Six Tier Open' });
    const two = await sportEvents.createEvent({ seasonSlotIds: [await testSlotId(getPrisma(), tour.id, new Date('2087-05-13T12:00:00.000Z'))], name: 'Two Tier Open' });
    await tiers.replaceTiers({ sportEventId: two.event.id, tiers: [tier(1), tier(2)] });

    const counts = [];
    for (const [event, size] of [[two, 2], [six, 6]] as const) {
      const { statements } = await recordStatements(() => integrationSportEventServices().tiers.replaceTiers({
        sportEventId: event.event.id,
        tiers: [...Array.from({ length: size }, (_, index) => tier(index + 1)), tier(size + 1)],
      }));
      counts.push(statementCounts(statements));
    }

    expect(counts[1]).toEqual(counts[0]);
  });

  it('reverses, removes and adds tiers in one save, a new tier taking a removed one\'s number and kept tiers keeping their rows', async () => {
    const tour = await golfTour();
    const { sportEvents, tiers } = integrationSportEventServices();
    const created = await sportEvents.createEvent({ seasonSlotIds: [await testSlotId(getPrisma(), tour.id, new Date('2087-05-06T12:00:00.000Z'))], name: 'Shuffle Open' });
    const before = await getPrisma().sportEventTier.findMany({ where: { sportEventId: created.event.id } });
    const idByKey = new Map(before.map((row) => [row.tierKey, row.id]));

    await tiers.replaceTiers({
      sportEventId: created.event.id,
      tiers: [
        ...[1, 2, 3, 4, 5].map((index) => ({ ...tier(index), tierNumber: 6 - index })),
        { tierKey: 'tier-new', tierNumber: 6 },
      ],
    });

    const after = await getPrisma().sportEventTier.findMany({ where: { sportEventId: created.event.id }, orderBy: { tierNumber: 'asc' } });
    expect(after.map((row) => [row.tierKey, row.tierNumber])).toEqual([
      ['tier-5', 1], ['tier-4', 2], ['tier-3', 3], ['tier-2', 4], ['tier-1', 5], ['tier-new', 6],
    ]);
    expect(after.filter((row) => row.tierKey !== 'tier-new').every((row) => row.id === idByKey.get(row.tierKey))).toBe(true);
  });
});
