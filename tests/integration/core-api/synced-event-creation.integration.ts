import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Sport } from '@poolmaster/shared/domain';
import { PrismaSportLeagueRepository } from '../../../packages/core-api/src/adapters';
import { SyncedEventCreationScheduler } from '../../../packages/core-api/src/modules/events/synced-event-creation-scheduler';
import { createSportEventServices } from '../../../packages/core-api/src/modules/events/wiring';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { heldHere } from '../../support/job-locks';

// A synced sport league's events created by the daily sweep (ADR 0011, #1725) against real
// Postgres: the leagues it reads, the events the admin's year import writes for them, and a second
// sweep that writes nothing. The provider's tour list is the one stand-in: which provider events
// belong to a league's tour is EventScoreSourceService's, tested on its own.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const PROVIDER_ID = 'integration-test';
const NOW = new Date('2027-03-01T12:00:00Z');

async function golfLeague(data: { matchKeyword: string; eventSyncProviderId: string | null; isActive?: boolean }) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  return prisma.sportLeague.create({ data: { sportId: sport.id, name: `Synced Tour ${randomUUID().slice(0, 8)}`, ...data } });
}

/** The provider's events for a tour and year: one tournament a year, named by its tour. */
function tourEvent(tour: string, eventYear: number) {
  const startDate = new Date(Date.UTC(eventYear, 5, 10, 12));
  return { externalId: `${tour}-${eventYear}`, name: `${tour} Open`, venue: 'Course', startDate, endDate: new Date(Date.UTC(eventYear, 5, 13, 12)) };
}

function buildScheduler() {
  const prisma = getAppPrisma();
  const listTourEventsForYear = jest.fn(async (_providerId: string, sportLeagueId: string, eventYear: number) => {
    const league = await getPrisma().sportLeague.findUniqueOrThrow({ where: { id: sportLeagueId } });
    return [tourEvent(league.matchKeyword ?? '', eventYear)];
  });
  const scheduler = new SyncedEventCreationScheduler({
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    scoreSource: { listTourEventsForYear },
    sportEvents: createSportEventServices(prisma).sportEvents,
    jobLock: heldHere(),
    now: () => NOW,
  });
  return { scheduler, listTourEventsForYear };
}

describe('Synced event creation (ADR 0011)', () => {
  it('creates each synced league\'s events for this year and next as linked drafts, and nothing for leagues not synced or inactive', async () => {
    const synced = await golfLeague({ matchKeyword: `SYNC${randomUUID().slice(0, 4)}`, eventSyncProviderId: PROVIDER_ID });
    const unsynced = await golfLeague({ matchKeyword: 'MANUAL', eventSyncProviderId: null });
    const inactive = await golfLeague({ matchKeyword: 'RETIRED', eventSyncProviderId: PROVIDER_ID, isActive: false });
    const { scheduler, listTourEventsForYear } = buildScheduler();

    await scheduler.runSweep();

    const events = await getPrisma().sportEvent.findMany({
      where: { eventSeries: { sportLeagueId: { in: [synced.id, unsynced.id, inactive.id] } } },
      include: { eventSeries: true },
      orderBy: { eventYear: 'asc' },
    });
    expect(events.map((event) => [event.eventSeries.sportLeagueId, event.eventYear, event.providerId, event.externalId, event.status, event.syncScope])).toEqual([
      [synced.id, 2027, PROVIDER_ID, `${synced.matchKeyword}-2027`, 'DRAFT', 'SCORES_ONLY'],
      [synced.id, 2028, PROVIDER_ID, `${synced.matchKeyword}-2028`, 'DRAFT', 'SCORES_ONLY'],
    ]);
    expect(new Set(listTourEventsForYear.mock.calls.map(([, sportLeagueId]) => sportLeagueId))).toEqual(new Set([synced.id]));
  });

  it('creates nothing on a second sweep: the events are already linked', async () => {
    const synced = await golfLeague({ matchKeyword: `SYNC${randomUUID().slice(0, 4)}`, eventSyncProviderId: PROVIDER_ID });
    const { scheduler } = buildScheduler();

    await scheduler.runSweep();
    await scheduler.runSweep();

    expect(await getPrisma().sportEvent.count({ where: { eventSeries: { sportLeagueId: synced.id } } })).toBe(2);
  });
});
