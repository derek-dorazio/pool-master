import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Sport } from '@poolmaster/shared/domain';
import { PrismaProviderSyncRunRepository, PrismaSportLeagueRepository, PrismaSportRepository } from '../../../packages/core-api/src/adapters';
import { LeagueEventsSync } from '../../../packages/core-api/src/modules/events/league-events-sync';
import { INGESTION_SCHEDULE_SETTINGS } from '../../../packages/core-api/src/modules/platform/ingestion-config-service';
import { SyncedEventCreationScheduler } from '../../../packages/core-api/src/modules/events/synced-event-creation-scheduler';
import { mapSportEventToDto } from '../../../packages/core-api/src/mappers/sport-events.mapper';
import { cleanupTestData, getAppPrisma, getPrisma, integrationBackgroundJobs, setupIntegrationTests, teardownIntegrationTests, integrationSportEventServices } from '../helpers';
import { heldHere } from '../../support/job-locks';
import { leagueProfiles } from '../../support/league-profiles';
import { SYNCED_PROVIDER_ID, syncLeagueTo } from '../../support/league-sync';

// A synced sport league's events created by the six-hourly sweep (ADR 0011, #1725) against real
// Postgres: the sweep queues one events sync job per synced league (#1819), the job runner runs
// them, and they write the league's events; a second sweep writes nothing. The provider's tour list is the one stand-in: which provider events
// belong to a league's tour is EventScoreSourceService's, tested on its own.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const PROVIDER_ID = SYNCED_PROVIDER_ID;
const NOW = new Date('2027-03-01T12:00:00Z');

/** A golf league named for its tour, synced from BALLDONTLIE's PGA TOUR unless `synced` is false. */
async function golfLeague({ synced = true, isActive = true }: { synced?: boolean; isActive?: boolean } = {}) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const league = await prisma.sportLeague.create({ data: { ...(await leagueProfiles(prisma)), sportId: sport.id, name: `Synced Tour ${randomUUID().slice(0, 8)}`, isActive } });
  if (synced) await syncLeagueTo(prisma, league.id, 'pga');
  return league;
}

const DAY = 24 * 60 * 60 * 1000;

/** The provider's events for a tour and year: one tournament a year, named by its tour, moved by `shiftDays`. */
function tourEvent(tour: string, eventYear: number, shiftDays = 0, name = `${tour} Open`) {
  const startDate = new Date(Date.UTC(eventYear, 5, 10, 12) + shiftDays * DAY);
  return { externalId: `${tour}-${eventYear}`, name, venue: 'Course', startDate, endDate: new Date(Date.UTC(eventYear, 5, 13, 12) + shiftDays * DAY) };
}

function buildScheduler(feed: { shiftDays: number; name?: string } = { shiftDays: 0 }) {
  const prisma = getAppPrisma();
  const listTourEventsForYear = jest.fn(async (_providerId: string, sportLeagueId: string, eventYear: number) => {
    const league = await getPrisma().sportLeague.findUniqueOrThrow({ where: { id: sportLeagueId } });
    return [tourEvent(league.name, eventYear, feed.shiftDays, feed.name)];
  });
  const backgroundJobs = integrationBackgroundJobs(prisma);
  const leagueEventsSync = new LeagueEventsSync({
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    sports: new PrismaSportRepository(prisma),
    scoreSource: { listTourEventsForYear },
    sportEvents: integrationSportEventServices(prisma).sportEvents,
    syncRuns: new PrismaProviderSyncRunRepository(prisma),
    jobs: backgroundJobs.queue,
    now: () => NOW,
  });
  const runner = backgroundJobs.runWith({ SYNC_LEAGUE_EVENTS: (payload, context) => leagueEventsSync.run(payload, context) });
  const sweeper = new SyncedEventCreationScheduler({
    leagueEventsSync,
    schedule: { getConfig: () => Promise.resolve(INGESTION_SCHEDULE_SETTINGS.defaults({})) },
    jobLock: heldHere(),
  });
  /** One sweep, and the jobs it queued run to the end. */
  const scheduler = {
    async runSweep(): Promise<void> {
      await sweeper.runSweep();
      await runner.drain();
    },
  };
  return { scheduler, listTourEventsForYear, leagueEventsSync, runner };
}

describe('Synced event creation (ADR 0011)', () => {
  it('creates each synced league\'s events for this year and next as linked drafts, and nothing for leagues not synced or inactive', async () => {
    const synced = await golfLeague();
    const unsynced = await golfLeague({ synced: false });
    const inactive = await golfLeague({ isActive: false });
    const { scheduler, listTourEventsForYear } = buildScheduler();

    await scheduler.runSweep();

    const events = await getPrisma().sportEvent.findMany({
      where: { eventSeries: { sportLeagueId: { in: [synced.id, unsynced.id, inactive.id] } } },
      include: { eventSeries: true },
      orderBy: { eventYear: 'asc' },
    });
    expect(events.map((event) => [event.eventSeries.sportLeagueId, event.eventYear, event.providerId, event.externalId, event.status, event.syncScope])).toEqual([
      [synced.id, 2027, PROVIDER_ID, `${synced.name}-2027`, 'DRAFT', 'SCORES_ONLY'],
      [synced.id, 2028, PROVIDER_ID, `${synced.name}-2028`, 'DRAFT', 'SCORES_ONLY'],
    ]);
    expect(new Set(listTourEventsForYear.mock.calls.map(([, sportLeagueId]) => sportLeagueId))).toEqual(new Set([synced.id]));
  });

  it('creates nothing on a second sweep: the events are already linked', async () => {
    const synced = await golfLeague();
    const { scheduler } = buildScheduler();

    await scheduler.runSweep();
    await scheduler.runSweep();

    expect(await getPrisma().sportEvent.count({ where: { eventSeries: { sportLeagueId: synced.id } } })).toBe(2);
  });

  it('moves a released event and its rounds when the provider moves it, renames it, and leaves a completed one as it was (#1727)', async () => {
    const synced = await golfLeague();
    const feed = { shiftDays: 0, name: undefined as string | undefined };
    const { scheduler } = buildScheduler(feed);
    await scheduler.runSweep();
    const prisma = getPrisma();
    const [released, completed] = await prisma.sportEvent.findMany({ where: { eventSeries: { sportLeagueId: synced.id } }, orderBy: { eventYear: 'asc' } });
    await prisma.sportEvent.update({ where: { id: released.id }, data: { status: 'SCHEDULED' } });
    await prisma.sportEvent.update({ where: { id: completed.id }, data: { status: 'COMPLETED' } });

    feed.shiftDays = 7;
    feed.name = 'Renamed Open';
    await scheduler.runSweep();

    const after = await prisma.sportEvent.findMany({
      where: { id: { in: [released.id, completed.id] } },
      include: { roundSchedule: { orderBy: { roundNumber: 'asc' } } },
      orderBy: { eventYear: 'asc' },
    });
    expect(after.map((event) => [event.name, event.startDate.toISOString(), event.roundSchedule[0]?.scheduledDate.toISOString()])).toEqual([
      ['Renamed Open', '2027-06-17T12:00:00.000Z', '2027-06-17T12:00:00.000Z'],
      [completed.name, completed.startDate.toISOString(), completed.startDate.toISOString()],
    ]);
  });

  it('reads each created event as provider-synced, and an admin-authored event of the same league as not (#1729)', async () => {
    const synced = await golfLeague();
    const { scheduler } = buildScheduler();
    await scheduler.runSweep();
    const { sportEvents } = integrationSportEventServices();
    const manual = await sportEvents.createEvent({
      sportLeagueId: synced.id,
      eventYear: 2027,
      name: 'Members Cup',
      startDate: new Date('2027-08-01T12:00:00Z'),
    });

    const events = await getPrisma().sportEvent.findMany({ where: { eventSeries: { sportLeagueId: synced.id } }, select: { id: true } });
    const flags = await Promise.all(events.map(async ({ id }) => {
      const read = mapSportEventToDto(await sportEvents.requireAdminSummary(id));
      return [read.name, read.providerSynced] as const;
    }));
    const byName = (a: readonly [string, boolean], b: readonly [string, boolean]) => a[0].localeCompare(b[0]);
    expect([...flags].sort(byName)).toEqual(([
      ['Members Cup', false],
      [`${synced.name} Open`, true],
      [`${synced.name} Open`, true],
    ] as const).slice().sort(byName));
    expect(manual.event.providerId).not.toBe(PROVIDER_ID);
  });
});
