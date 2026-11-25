import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ProviderSyncFindingKind, ProviderSyncFindingSeverity, ProviderSyncFindingStatus, Sport } from '@poolmaster/shared/domain';
import { PrismaProviderSyncRunRepository, PrismaSportLeagueRepository } from '../../../packages/core-api/src/adapters';
import { PrismaSportLeagueSeasonRepository } from '../../../packages/core-api/src/adapters/prisma-sport-league-season-repository';
import { LeagueEventsSync } from '../../../packages/core-api/src/modules/events/league-events-sync';
import { ProviderSeasonScheduleReader, type ProviderEventDetailSummary } from '../../../packages/core-api/src/modules/events/provider-season-schedule-reader';
import { BalldontlieAdapter } from '../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import { BALLDONTLIE_TEST_LEAGUES } from '../../support/balldontlie-provider-rows';
import { cleanupTestData, getAppPrisma, getPrisma, integrationBackgroundJobs, integrationSportEventServices, integrationSyncFindings, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { syncLeagueTo, syncSeasonsTo } from '../../support/league-sync';
import { sportRowKeys } from '../../support/sport-rows';
import { sportPlay } from '../../support/sport-play';
import { syncSlotsFor, type TestSlotWindow } from '../../support/sync-slots';
import { recordStatements, statementCounts } from '../statement-log';
import { JobTrigger } from '@poolmaster/shared/domain';

// The events sync matching a provider's games to Season slots by the code the provider names their
// place by (league model slice 8, #2005), against real Postgres. The provider's slate is the one
// stand-in: how the adapter reduces each league's games to codes is tested on its own.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const NOW = new Date('2027-03-01T12:00:00Z');

type SlateEvent = ProviderEventDetailSummary & { externalId: string };

/** A play of one code, its games from `start` to `end`. */
const play = (code: string, start: string, end = start) => ({ code, startsAt: new Date(start), endsAt: new Date(end) });

/** A provider event whose games are in `plays`, its dates their span. */
function slateEvent(externalId: string, name: string, plays: ReturnType<typeof play>[]): SlateEvent {
  const starts = plays.map((each) => each.startsAt.getTime());
  const ends = plays.map((each) => each.endsAt.getTime());
  return { externalId, name, venue: null, startDate: new Date(Math.min(...starts)), endDate: new Date(Math.max(...ends)), providerSlots: plays };
}

/**
 * A football league synced from BALLDONTLIE's NFL, with its 2027 Season current, and a slot for
 * each code in `slots`: listed by a template unless `covered` is false.
 */
async function footballLeague(slots: ReadonlyArray<{ code: string; covered?: boolean }>) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.AMERICAN_FOOTBALL },
    create: { sport: Sport.AMERICAN_FOOTBALL, ...sportRowKeys(Sport.AMERICAN_FOOTBALL), tournamentFormat: 'MATCHES' },
    update: {},
  });
  const league = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Slot League ${randomUUID().slice(0, 8)}` } });
  const sportLeagueProviderMappingId = await syncLeagueTo(prisma, league.id, 'nfl');
  const [seasonId] = await syncSeasonsTo(prisma, league.id, sportLeagueProviderMappingId, [2027]);
  const slotIds = new Map<string, string>();
  for (const slot of slots) {
    const [id] = await syncSlotsFor(prisma, { sportLeagueId: league.id, sportLeagueProviderMappingId, code: slot.code, seasonIds: [seasonId], covered: slot.covered });
    slotIds.set(slot.code, id);
  }
  return { league, seasonId, slotIds };
}

/** The league's events sync over `slate`, a list the test can change between runs. */
function buildSync(slate: { events: SlateEvent[] } | Pick<ProviderSeasonScheduleReader, 'listSeasonEvents'>) {
  const prisma = getAppPrisma();
  const backgroundJobs = integrationBackgroundJobs(prisma);
  return new LeagueEventsSync({
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    seasonSchedule: 'events' in slate ? { listSeasonEvents: async () => slate.events } : slate,
    seasons: new PrismaSportLeagueSeasonRepository(prisma),
    findings: integrationSyncFindings(prisma),
    sportEvents: integrationSportEventServices(prisma).sportEvents,
    syncRuns: new PrismaProviderSyncRunRepository(prisma),
    jobs: backgroundJobs.queue,
    now: () => NOW,
  });
}

const runSync = (sync: LeagueEventsSync, sportLeagueId: string) =>
  sync.run({ sportLeagueId }, { jobId: randomUUID(), attempt: 1, renewLease: async () => true, trigger: JobTrigger.SCHEDULE });

/** Each of the league's events, by name, with the Season slots it plays. */
async function eventsWithSlots(sportLeagueId: string) {
  const events = await getPrisma().sportEvent.findMany({
    where: { sportLeagueId },
    select: { name: true, startDate: true, endDate: true, slots: { select: { sportLeagueSeasonPhaseSlotId: true }, orderBy: { createdAt: 'asc' } } },
    orderBy: { name: 'asc' },
  });
  return events.map((event) => ({ name: event.name, startDate: event.startDate, endDate: event.endDate, slotIds: event.slots.map((slot) => slot.sportLeagueSeasonPhaseSlotId).sort() }));
}

describe('The events sync matches games to Season slots by provider code (#2005)', () => {
  it('puts a week\'s games on the slot its PROVIDER_CODE mapping names, linking the event to that slot and giving the slot its games\' dates', async () => {
    const { league, slotIds } = await footballLeague([{ code: 'REG:5' }]);
    const week = slateEvent('nfl-2027-week-5', 'NFL Week 5', [play('REG:5', '2027-10-07T00:15:00Z', '2027-10-12T00:15:00Z')]);

    await runSync(buildSync({ events: [week] }), league.id);

    expect(await eventsWithSlots(league.id)).toEqual([{ name: 'NFL Week 5', startDate: new Date('2027-10-07T00:15:00Z'), endDate: new Date('2027-10-12T00:15:00Z'), slotIds: [slotIds.get('REG:5')] }]);
    const slot = await getPrisma().sportLeagueSeasonPhaseSlot.findUniqueOrThrow({ where: { id: slotIds.get('REG:5') } });
    expect([slot.startsAt, slot.endsAt]).toEqual([new Date('2027-10-07T00:15:00Z'), new Date('2027-10-12T00:15:00Z')]);
  });

  it('creates no event for a slot no contest template lists, though the slot takes its games\' dates (ADR 0011)', async () => {
    const { league, slotIds } = await footballLeague([{ code: 'REG:6', covered: false }]);
    const week = slateEvent('nfl-2027-week-6', 'NFL Week 6', [play('REG:6', '2027-10-14T00:15:00Z', '2027-10-19T00:15:00Z')]);

    await runSync(buildSync({ events: [week] }), league.id);

    expect(await eventsWithSlots(league.id)).toEqual([]);
    expect((await getPrisma().sportLeagueSeasonPhaseSlot.findUniqueOrThrow({ where: { id: slotIds.get('REG:6') } })).startsAt).toEqual(new Date('2027-10-14T00:15:00Z'));
  });

  it('gives a playoff event each later round\'s slot as its games arrive, and its dates follow', async () => {
    const { league, slotIds } = await footballLeague([{ code: 'POST:1' }, { code: 'POST:2' }]);
    const roundOne = play('POST:1', '2028-01-08T21:30:00Z', '2028-01-10T01:15:00Z');
    const slate = { events: [slateEvent('nfl-2027-postseason', 'NFL Playoffs', [roundOne])] };
    const sync = buildSync(slate);
    await runSync(sync, league.id);

    slate.events = [slateEvent('nfl-2027-postseason', 'NFL Playoffs', [roundOne, play('POST:2', '2028-01-15T21:30:00Z', '2028-01-17T01:15:00Z')])];
    await runSync(sync, league.id);

    expect(await eventsWithSlots(league.id)).toEqual([{
      name: 'NFL Playoffs',
      startDate: new Date('2028-01-08T21:30:00Z'),
      endDate: new Date('2028-01-17T01:15:00Z'),
      slotIds: [slotIds.get('POST:1') ?? '', slotIds.get('POST:2') ?? ''].sort(),
    }]);
  });

  it('raises one INFO SLOT_VALUE_UNMAPPED finding per league and code, seen again on the next sync, and leaves a waived one waived', async () => {
    const { league } = await footballLeague([{ code: 'POST:1' }]);
    const allStar = slateEvent('nfl-2027-postseason', 'NFL Playoffs', [play('POST:1', '2028-01-08T21:30:00Z'), play('POST:4', '2028-02-01T20:00:00Z')]);
    const preseason = slateEvent('nfl-2027-pre-1', 'Preseason Week 1', [play('PRE:1', '2027-08-06T00:00:00Z')]);
    const sync = buildSync({ events: [allStar, preseason] });
    await runSync(sync, league.id);
    // The playoff is dated after the 2027 Season, which its own WARNING covers; this test is the codes'.
    const findings = () => getPrisma().providerSyncFinding.findMany({ where: { sportLeagueId: league.id, kind: ProviderSyncFindingKind.SLOT_VALUE_UNMAPPED }, orderBy: { providerValue: 'asc' } });
    const waived = (await findings()).find((finding) => finding.providerValue === 'PRE:1');
    await getPrisma().providerSyncFinding.update({ where: { id: waived?.id }, data: { status: ProviderSyncFindingStatus.WAIVED, waiveNote: 'The preseason is not played here.' } });

    await runSync(sync, league.id);

    expect((await findings()).map((finding) => [finding.kind, finding.severity, finding.providerValue, finding.providerValueName, finding.status, finding.seenCount])).toEqual([
      [ProviderSyncFindingKind.SLOT_VALUE_UNMAPPED, ProviderSyncFindingSeverity.INFO, 'POST:4', 'NFL Playoffs', ProviderSyncFindingStatus.OPEN, 2],
      [ProviderSyncFindingKind.SLOT_VALUE_UNMAPPED, ProviderSyncFindingSeverity.INFO, 'PRE:1', 'Preseason Week 1', ProviderSyncFindingStatus.WAIVED, 2],
    ]);
    expect((await eventsWithSlots(league.id)).map((event) => event.name)).toEqual(['NFL Playoffs']);
  });

  it('deletes nothing when a later page lists fewer events or games: the event keeps its slots and the missing event stays', async () => {
    const { league, slotIds } = await footballLeague([{ code: 'REG:7' }, { code: 'REG:8' }]);
    const slate = { events: [
      slateEvent('nfl-2027-week-7', 'NFL Week 7', [play('REG:7', '2027-10-21T00:15:00Z')]),
      slateEvent('nfl-2027-week-8', 'NFL Week 8', [play('REG:8', '2027-10-28T00:15:00Z')]),
    ] };
    const sync = buildSync(slate);
    await runSync(sync, league.id);
    const before = await eventsWithSlots(league.id);

    slate.events = [{ ...slate.events[0], providerSlots: [] }];
    await runSync(sync, league.id);

    expect(await eventsWithSlots(league.id)).toEqual(before);
    expect(before.flatMap((event) => event.slotIds)).toEqual([slotIds.get('REG:7'), slotIds.get('REG:8')]);
  });
});

/**
 * A college football league synced from BALLDONTLIE's NCAAF, its 2027 Season current, with a slot
 * placed by date window for each of `slots`: `window` its window, or none.
 */
async function windowedLeague(slots: ReadonlyArray<{ key: string; window: TestSlotWindow | undefined }>) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.AMERICAN_FOOTBALL },
    create: { sport: Sport.AMERICAN_FOOTBALL, ...sportRowKeys(Sport.AMERICAN_FOOTBALL), tournamentFormat: 'MATCHES' },
    update: {},
  });
  const league = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Window League ${randomUUID().slice(0, 8)}` } });
  const sportLeagueProviderMappingId = await syncLeagueTo(prisma, league.id, 'ncaaf');
  const [seasonId] = await syncSeasonsTo(prisma, league.id, sportLeagueProviderMappingId, [2027]);
  const slotIds = new Map<string, string>();
  for (const slot of slots) {
    const [id] = await syncSlotsFor(prisma, { sportLeagueId: league.id, sportLeagueProviderMappingId, code: null, seasonIds: [seasonId], window: slot.window });
    slotIds.set(slot.key, id);
  }
  return { league, seasonId, sportLeagueProviderMappingId, slotIds };
}

const kickoff = (iso: string) => ({ code: null, startsAt: new Date(iso), endsAt: new Date(iso) });
const windowOf = (from: string, to: string, status: TestSlotWindow['status']): TestSlotWindow => ({ startsAt: new Date(from), endsAt: new Date(to), status });

/** A season's slate as the college football adapter sends it: every game a play with no code. */
function seasonSlate(plays: ReturnType<typeof kickoff>[]): SlateEvent {
  const starts = plays.map((each) => each.startsAt.getTime());
  return { externalId: 'ncaaf-2027-cfp', name: 'College Football Playoff', venue: null, startDate: new Date(Math.min(...starts)), endDate: new Date(Math.max(...starts)), providerSlots: plays };
}

describe('The events sync places games with no code by their Season slot\'s date window (#2012)', () => {
  const findingsOf = (sportLeagueId: string) => getPrisma().providerSyncFinding.findMany({ where: { sportLeagueId }, orderBy: { kind: 'asc' } });

  it('places a season\'s windowed games on their slots, a later round on the next sync, confirms the tentative window it places a game in, and raises one INFO for the games no window holds', async () => {
    const prisma = getPrisma();
    const { league, slotIds } = await windowedLeague([
      { key: 'first', window: windowOf('2027-12-18T10:00:00Z', '2027-12-20T12:00:00Z', 'TENTATIVE') },
      { key: 'semi', window: windowOf('2027-12-27T10:00:00Z', '2027-12-29T12:00:00Z', 'CONFIRMED') },
    ]);
    const regularSeason = kickoff('2027-09-04T16:00:00Z');
    const firstRound = [kickoff('2027-12-18T17:00:00Z'), kickoff('2027-12-19T01:00:00Z')];
    const slate = { events: [seasonSlate([regularSeason, ...firstRound])] };
    const sync = buildSync(slate);

    await runSync(sync, league.id);
    slate.events = [seasonSlate([regularSeason, ...firstRound, kickoff('2027-12-28T20:00:00Z')])];
    await runSync(sync, league.id);

    expect(await eventsWithSlots(league.id)).toEqual([{
      name: 'College Football Playoff',
      startDate: new Date('2027-12-18T17:00:00Z'),
      endDate: new Date('2027-12-28T20:00:00Z'),
      slotIds: [slotIds.get('first') ?? '', slotIds.get('semi') ?? ''].sort(),
    }]);
    const first = await prisma.sportLeagueSeasonPhaseSlot.findUniqueOrThrow({ where: { id: slotIds.get('first') } });
    expect([first.windowStatus, first.startsAt, first.endsAt]).toEqual(['CONFIRMED', new Date('2027-12-18T17:00:00Z'), new Date('2027-12-19T01:00:00Z')]);
    expect((await findingsOf(league.id)).map((finding) => [finding.kind, finding.severity, finding.providerValueName, finding.status]))
      .toEqual([[ProviderSyncFindingKind.GAMES_UNPLACED, ProviderSyncFindingSeverity.INFO, 'College Football Playoff', ProviderSyncFindingStatus.OPEN]]);
  });

  it('raises one WARNING for a windowed game dated after its Season ends, and still writes it', async () => {
    const { league, slotIds } = await windowedLeague([{ key: 'final', window: windowOf('2027-12-31T10:00:00Z', '2028-01-02T12:00:00Z', 'CONFIRMED') }]);

    await runSync(buildSync({ events: [seasonSlate([kickoff('2028-01-01T22:00:00Z')])] }), league.id);

    expect((await eventsWithSlots(league.id)).map((event) => event.slotIds)).toEqual([[slotIds.get('final')]]);
    expect((await findingsOf(league.id)).map((finding) => [finding.kind, finding.severity, finding.providerValue]))
      .toEqual([[ProviderSyncFindingKind.SLOT_OUTSIDE_SEASON, ProviderSyncFindingSeverity.WARNING, null]]);
  });

  it('raises one WARNING naming the Season\'s date-window slots with no window or a tentative one, and resolves it once every window is confirmed', async () => {
    const prisma = getPrisma();
    const { league, slotIds } = await windowedLeague([
      { key: 'first', window: windowOf('2027-12-18T10:00:00Z', '2027-12-20T12:00:00Z', 'TENTATIVE') },
      { key: 'final', window: undefined },
    ]);
    const sync = buildSync({ events: [] });
    await runSync(sync, league.id);
    const keys = await prisma.sportLeaguePhaseSlot.findMany({ where: { seasonSlots: { some: { id: { in: [...slotIds.values()] } } } }, select: { key: true }, orderBy: { key: 'asc' } });
    expect((await findingsOf(league.id)).map((finding) => [finding.kind, finding.severity, finding.providerValue, finding.providerValueName?.split(', ').sort(), finding.status]))
      .toEqual([[ProviderSyncFindingKind.SLOT_DATES_NEEDED, ProviderSyncFindingSeverity.WARNING, '2027', keys.map((row) => row.key), ProviderSyncFindingStatus.OPEN]]);

    await prisma.sportLeagueSeasonPhaseSlot.updateMany({ where: { id: { in: [...slotIds.values()] } }, data: { windowStartsAt: new Date('2027-12-18T10:00:00Z'), windowEndsAt: new Date('2027-12-20T12:00:00Z'), windowStatus: 'CONFIRMED' } });
    await runSync(sync, league.id);

    expect((await findingsOf(league.id)).map((finding) => [finding.kind, finding.status])).toEqual([[ProviderSyncFindingKind.SLOT_DATES_NEEDED, ProviderSyncFindingStatus.RESOLVED]]);
  });

  it('places any number of windowed games in the same number of statements', async () => {
    const importInto = async (plays: ReturnType<typeof kickoff>[]) => {
      const { league, seasonId, sportLeagueProviderMappingId } = await windowedLeague([
        { key: 'first', window: windowOf('2027-12-18T10:00:00Z', '2027-12-20T12:00:00Z', 'TENTATIVE') },
        { key: 'semi', window: windowOf('2027-12-27T10:00:00Z', '2027-12-29T12:00:00Z', 'TENTATIVE') },
      ]);
      const { sportEvents } = integrationSportEventServices(getAppPrisma());
      return recordStatements(() => sportEvents.importProviderSeason({
        sportLeagueId: league.id, sportLeagueSeasonId: seasonId, providerId: 'balldontlie', sportLeagueProviderMappingId, providerEvents: [{ ...seasonSlate(plays), externalId: `ncaaf-cfp-${randomUUID()}` }],
      }));
    };

    const few = await importInto([kickoff('2027-12-18T17:00:00Z'), kickoff('2027-12-28T20:00:00Z')]);
    const many = await importInto(Array.from({ length: 12 }, (_, index) => kickoff(`2027-12-${index < 6 ? '18' : '28'}T${String(10 + index).padStart(2, '0')}:00:00Z`)));

    // One read of the Season's slots, the event in one insert, and the slot links, dates and
    // confirmed windows in one transaction: the two slots' date updates and one window update.
    expect(many.result.created).toHaveLength(1);
    expect(statementCounts(many.statements)).toEqual(statementCounts(few.statements));
  });
});

describe('The events sync\'s findings name the Provider by its row', () => {
  it('raises SEASON_MISSING against the league\'s Provider row when its last mapped Season has ended, and still syncs', async () => {
    const prisma = getPrisma();
    const { league, seasonId } = await footballLeague([]);
    await prisma.sportLeagueSeason.update({ where: { id: seasonId }, data: { endsAt: new Date('2027-02-01T00:00:00Z') } });

    const outcome = await runSync(buildSync({ events: [] }), league.id);

    const provider = await prisma.provider.findFirstOrThrow({ where: { code: 'BALLDONTLIE' }, select: { id: true } });
    expect((await prisma.providerSyncFinding.findMany({ where: { sportLeagueId: league.id } })).map((finding) => [finding.kind, finding.providerId]))
      .toEqual([[ProviderSyncFindingKind.SEASON_MISSING, provider.id]]);
    expect(outcome.changedCount).toBe(0);
  });
});

describe('The events sync reads only a league its provider reads (#2005)', () => {
  it('raises one PROVIDER_LEAGUE_UNKNOWN ERROR finding against the Provider row, reads nothing and fails the job for good, when the provider has no enabled league with the mapping\'s code', async () => {
    const prisma = getPrisma();
    const { league } = await footballLeague([{ code: 'REG:5' }]);
    // BALLDONTLIE with golf alone enabled: the league's mapping names the NFL, which it does not read.
    const requests: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = (input) => { requests.push(String(input instanceof Request ? input.url : input)); return Promise.reject(new Error('no request expected')); };
    try {
      const registry = new ProviderRegistry();
      registry.register(new BalldontlieAdapter({
        connection: () => ({ baseUrl: 'https://api.balldontlie.io', requestsPerMinute: 600 }),
        apiKey: 'test-api-key',
        leagues: BALLDONTLIE_TEST_LEAGUES.filter((row) => row.code === 'pga'),
      }));
      const sync = buildSync(new ProviderSeasonScheduleReader(getAppPrisma(), registry));

      await expect(runSync(sync, league.id)).rejects.toMatchObject({ name: 'PermanentBackgroundJobError', message: expect.stringContaining('PROVIDER_LEAGUE_UNKNOWN') as unknown });
      await expect(runSync(sync, league.id)).rejects.toMatchObject({ name: 'PermanentBackgroundJobError' });
    } finally {
      global.fetch = originalFetch;
    }

    const provider = await prisma.provider.findFirstOrThrow({ where: { code: 'BALLDONTLIE' }, select: { id: true } });
    expect((await prisma.providerSyncFinding.findMany({ where: { sportLeagueId: league.id } })).map((finding) => [finding.kind, finding.severity, finding.providerId, finding.seenCount]))
      .toEqual([[ProviderSyncFindingKind.PROVIDER_LEAGUE_UNKNOWN, ProviderSyncFindingSeverity.ERROR, provider.id, 2]]);
    expect(requests).toEqual([]);
    expect(await eventsWithSlots(league.id)).toEqual([]);
  });
  it('resolves the league\'s open PROVIDER_LEAGUE_UNKNOWN finding when a later events sync of it completes', async () => {
    const prisma = getPrisma();
    const { league } = await footballLeague([{ code: 'REG:5' }]);
    const provider = await prisma.provider.findFirstOrThrow({ where: { code: 'BALLDONTLIE' }, select: { id: true } });
    const registry = new ProviderRegistry();
    registry.register(new BalldontlieAdapter({
      connection: () => ({ baseUrl: 'https://api.balldontlie.io', requestsPerMinute: 600 }),
      apiKey: 'test-api-key',
      leagues: BALLDONTLIE_TEST_LEAGUES.filter((row) => row.code === 'pga'),
    }));
    await expect(runSync(buildSync(new ProviderSeasonScheduleReader(getAppPrisma(), registry)), league.id)).rejects.toMatchObject({ name: 'PermanentBackgroundJobError' });

    await runSync(buildSync({ events: [] }), league.id);

    expect((await prisma.providerSyncFinding.findMany({ where: { sportLeagueId: league.id } })).map((finding) => [finding.kind, finding.providerId, finding.status]))
      .toEqual([[ProviderSyncFindingKind.PROVIDER_LEAGUE_UNKNOWN, provider.id, ProviderSyncFindingStatus.RESOLVED]]);
  });
});
