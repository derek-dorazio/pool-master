import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ProviderCode, Sport } from '@poolmaster/shared/domain';
import { PrismaBackgroundJobRepository, PrismaProviderSyncRunRepository, PrismaSportLeagueRepository } from '../../../packages/core-api/src/adapters';
import { PrismaSyncDueWorkReader } from '../../../packages/core-api/src/adapters/prisma-sync-due-work-reader';
import { PrismaSportLeagueSeasonRepository } from '../../../packages/core-api/src/adapters/prisma-sport-league-season-repository';
import { LeagueEventsSync } from '../../../packages/core-api/src/modules/events/league-events-sync';
import { INGESTION_SCHEDULE_SETTINGS } from '../../../packages/core-api/src/modules/platform/ingestion-config-service';
import { SyncTick } from '../../../packages/core-api/src/modules/ingestion/sync-tick';
import { mapSportEventToDto } from '../../../packages/core-api/src/mappers/sport-events.mapper';
import { cleanupTestData, getAppPrisma, getPrisma, integrationBackgroundJobs, integrationSyncFindings, setupIntegrationTests, teardownIntegrationTests, integrationSportEventServices } from '../helpers';
import { heldHere } from '../../support/job-locks';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { syncLeagueTo, syncSeasonsTo } from '../../support/league-sync';
import { sportRowKeys } from '../../support/sport-rows';
import { sportPlay } from '../../support/sport-play';
import { testSlotId } from '../../support/test-slots';
import { syncSlotsFor } from '../../support/sync-slots';

// A synced sport league's events created by the sync tick (ADR 0011, #1725, #2009) against real
// Postgres: the tick queues one events sync job per synced league (#1819), the job runner runs
// them, and they write the league's events; a second tick writes nothing. The provider's tour list is the one stand-in: which provider events
// belong to a league's tour is ProviderSeasonScheduleReader's, tested on its own.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const NOW = new Date('2027-03-01T12:00:00Z');

/** A golf league named for its tour, synced from BALLDONTLIE's PGA TOUR unless `synced` is false. */
async function golfLeague({ synced = true, isActive = true }: { synced?: boolean; isActive?: boolean } = {}) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF) },
    update: {},
  });
  const league = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Synced Tour ${randomUUID().slice(0, 8)}`, isActive } });
  // A migration's league has its Seasons mapped to the provider's; this year's is current (#2003).
  if (synced) {
    const sportLeagueProviderMappingId = await syncLeagueTo(prisma, league.id, 'pga');
    const seasonIds = await syncSeasonsTo(prisma, league.id, sportLeagueProviderMappingId, [2027, 2028]);
    // Each Season's tournament has its slot, mapped by the provider's id for it and listed by a template (#2005).
    for (const [index, year] of [2027, 2028].entries()) {
      await syncSlotsFor(prisma, { sportLeagueId: league.id, sportLeagueProviderMappingId, code: tourEventId(league.name, year), seasonIds: [seasonIds[index]] });
    }
  }
  return league;
}

const DAY = 24 * 60 * 60 * 1000;

/** The provider's id for a tour's tournament in a year, which is also the code it names the tournament's place by. */
const tourEventId = (tour: string, year: number) => `${tour}-${year}`;

/** The provider's events for a tour and Season: one tournament a year, named by its tour, moved by `shiftDays`. */
function tourEvent(tour: string, year: number, shiftDays = 0, name = `${tour} Open`) {
  const startDate = new Date(Date.UTC(year, 5, 10, 12) + shiftDays * DAY);
  const endDate = new Date(Date.UTC(year, 5, 13, 12) + shiftDays * DAY);
  const externalId = tourEventId(tour, year);
  return { externalId, name, venue: 'Course', startDate, endDate, providerSlots: [{ code: externalId, startsAt: startDate, endsAt: endDate }] };
}

function buildScheduler(feed: { shiftDays: number; name?: string } = { shiftDays: 0 }) {
  const prisma = getAppPrisma();
  const listSeasonEvents = jest.fn(async (sportLeagueId: string, providerSeasonId: string) => {
    const league = await getPrisma().sportLeague.findUniqueOrThrow({ where: { id: sportLeagueId } });
    return [tourEvent(league.name, Number(providerSeasonId), feed.shiftDays, feed.name)];
  });
  const backgroundJobs = integrationBackgroundJobs(prisma);
  const leagueEventsSync = new LeagueEventsSync({
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    seasonSchedule: { listSeasonEvents },
    seasons: new PrismaSportLeagueSeasonRepository(prisma),
    findings: integrationSyncFindings(prisma),
    sportEvents: integrationSportEventServices(prisma).sportEvents,
    syncRuns: new PrismaProviderSyncRunRepository(prisma),
    jobs: backgroundJobs.queue,
    now: () => NOW,
  });
  const runner = backgroundJobs.runWith({
    SYNC_LEAGUE_EVENTS: (payload, context) => leagueEventsSync.run(payload, context),
    // The tick also syncs the field of the events it created; that sync is not this test's.
    SYNC_EVENT_FIELD: () => Promise.resolve({ changedCount: 0 }),
  });
  const tick = new SyncTick({
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    dueWork: new PrismaSyncDueWorkReader(prisma),
    jobHistory: new PrismaBackgroundJobRepository(prisma),
    jobs: backgroundJobs.queue,
    registry: registryWith(fakeSportDataProvider()),
    schedule: { getConfig: () => Promise.resolve(INGESTION_SCHEDULE_SETTINGS.defaults({})) },
    notifiedProviderCadence: () => undefined,
    // No provider league is quiet-checked here: the quiet live scores finding has its own tests.
    quietAfterMs: () => 0,
    leagueSendsNotifications: () => true,
    typicalGameMinutes: () => undefined,
    findings: { raiseOfSource: () => Promise.resolve(), resolveGamesNoLongerOverdue: () => Promise.resolve(0) },
    jobLock: heldHere(),
    // A tick a day after the last, so each league's events sync is due again even off season,
    // whose default interval is the longest (these leagues' Seasons have not started).
    now: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  /** One tick, and the jobs it queued run to the end. */
  const scheduler = {
    async runSweep(): Promise<void> {
      await tick.tick();
      await runner.drain();
    },
  };
  return { scheduler, listSeasonEvents, leagueEventsSync, runner };
}

describe('Synced event creation (ADR 0011)', () => {
  it('creates each synced league\'s events for its current Season and the next as linked drafts in those Seasons, and nothing for leagues not synced or inactive', async () => {
    const synced = await golfLeague();
    const unsynced = await golfLeague({ synced: false });
    const inactive = await golfLeague({ isActive: false });
    const { scheduler, listSeasonEvents } = buildScheduler();

    await scheduler.runSweep();

    const events = await getPrisma().sportEvent.findMany({
      where: { sportLeagueId: { in: [synced.id, unsynced.id, inactive.id] } },
      include: { sportLeagueSeason: true, providerMappings: { select: { externalId: true, provider: { select: { code: true } }, sportLeagueProviderMapping: { select: { selectedBy: { select: { id: true } } } } } } },
      orderBy: { startDate: 'asc' },
    });
    // Each created event is kept under the provider's id for it, through the league's selected mapping (#2004).
    expect(events.map((event) => [event.sportLeagueId, event.sportLeagueSeason.championshipYear, event.providerMappings, event.status])).toEqual([
      [synced.id, 2027, [{ externalId: `${synced.name}-2027`, provider: { code: ProviderCode.BALLDONTLIE }, sportLeagueProviderMapping: { selectedBy: { id: synced.id } } }], 'DRAFT'],
      [synced.id, 2028, [{ externalId: `${synced.name}-2028`, provider: { code: ProviderCode.BALLDONTLIE }, sportLeagueProviderMapping: { selectedBy: { id: synced.id } } }], 'DRAFT'],
    ]);
    expect(new Set(listSeasonEvents.mock.calls.map(([sportLeagueId]) => sportLeagueId))).toEqual(new Set([synced.id]));
  });

  it('creates nothing on a second sweep: the events are already linked', async () => {
    const synced = await golfLeague();
    const { scheduler } = buildScheduler();

    await scheduler.runSweep();
    await scheduler.runSweep();

    expect(await getPrisma().sportEvent.count({ where: { sportLeagueId: synced.id } })).toBe(2);
  });

  it('moves a released event and its rounds when the provider moves it, renames it, and leaves a completed one as it was (#1727)', async () => {
    const synced = await golfLeague();
    const feed = { shiftDays: 0, name: undefined as string | undefined };
    const { scheduler } = buildScheduler(feed);
    await scheduler.runSweep();
    const prisma = getPrisma();
    const [released, completed] = await prisma.sportEvent.findMany({ where: { sportLeagueId: synced.id }, orderBy: { startDate: 'asc' } });
    await prisma.sportEvent.update({ where: { id: released.id }, data: { status: 'SCHEDULED' } });
    await prisma.sportEvent.update({ where: { id: completed.id }, data: { status: 'COMPLETED' } });

    feed.shiftDays = 7;
    feed.name = 'Renamed Open';
    await scheduler.runSweep();

    const after = await prisma.sportEvent.findMany({
      where: { id: { in: [released.id, completed.id] } },
      include: { roundSchedule: { orderBy: { roundNumber: 'asc' } } },
      orderBy: { startDate: 'asc' },
    });
    expect(after.map((event) => [event.name, event.startDate.toISOString(), event.roundSchedule[0]?.scheduledDate.toISOString()])).toEqual([
      ['Renamed Open', '2027-06-17T12:00:00.000Z', '2027-06-17T12:00:00.000Z'],
      [completed.name, completed.startDate.toISOString(), completed.startDate.toISOString()],
    ]);
  });

  it('reads each event the sync created as synced, and a test event on a test slot of the same league as a test event (#1729, #2004)', async () => {
    const synced = await golfLeague();
    const { scheduler } = buildScheduler();
    await scheduler.runSweep();
    const { sportEvents } = integrationSportEventServices();
    const manual = await sportEvents.createEvent({
      seasonSlotIds: [await testSlotId(getPrisma(), synced.id, new Date('2027-08-01T12:00:00Z'))],
      name: 'Members Cup',
    });

    const events = await getPrisma().sportEvent.findMany({ where: { sportLeagueId: synced.id }, select: { id: true } });
    const flags = await Promise.all(events.map(async ({ id }) => {
      const read = mapSportEventToDto(await sportEvents.requireAdminSummary(id));
      return [read.name, !read.isTestData] as const;
    }));
    const byName = (a: readonly [string, boolean], b: readonly [string, boolean]) => a[0].localeCompare(b[0]);
    expect([...flags].sort(byName)).toEqual(([
      ['Members Cup', false],
      [`${synced.name} Open`, true],
      [`${synced.name} Open`, true],
    ] as const).slice().sort(byName));
    expect(manual.event.providerMappings).toEqual([]);
  });
});
