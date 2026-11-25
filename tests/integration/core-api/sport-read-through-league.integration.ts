/**
 * #2042 — a sport event and a sync run keep no copy of their sport: each belongs to a sport
 * league, and the league's sport is the row's sport. Their DTOs still carry `sport` (and an event
 * its sport's URL segment), read through the league on every answer. A contest template carries
 * no sport at all (#2010): a screen reads it from the template's sport league.
 *
 * Each case puts the row on a league of a sport other than golf, the fixtures' default, so an
 * answer that read the sport from anywhere but the league would show it.
 */
import { expect } from '@jest/globals';
import { Sport } from '@poolmaster/shared/domain';
import {
  ProviderSyncRunListResponseSchema,
  SportEventResponseSchema,
} from '@poolmaster/shared/dto';
import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { fixtureTourId, freshEventEdition } from '../../support/event-edition';
import { cleanupTestData, createTestUser, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { get, okBody } from '../list-route-seeds';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

describe('a row\'s sport is its sport league\'s (#2042)', () => {
  it('answers a sport event with its Season\'s league\'s sport and that sport\'s URL segment', async () => {
    const prisma = getPrisma();
    const event = await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma, { sport: Sport.BASKETBALL })),
        name: 'Read Through Classic',
        startDate: new Date('2099-03-19T16:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });

    const answered = okBody(await get(`/api/v1/events/${event.id}`, await createTestUser({ isRootAdmin: true })), SportEventResponseSchema);

    expect([answered.event.sport, answered.event.sportUrlSegment]).toEqual([Sport.BASKETBALL, 'basketball']);
  });

  it('answers a sync run with its sport league\'s sport, and filters runs by it', async () => {
    const prisma = getPrisma();
    const [hockey, golf] = await Promise.all([fixtureTourId(prisma, Sport.HOCKEY), fixtureTourId(prisma, Sport.GOLF)]);
    await prisma.providerSyncRun.createMany({
      data: [hockey, golf].map((sportLeagueId) => ({
        kind: 'EVENTS' as const, trigger: 'SCHEDULE' as const, providerId: BALLDONTLIE_TEST_PROVIDER_ID, sportLeagueId, status: 'COMPLETED' as const,
      })),
    });

    const answered = okBody(
      await get(`/api/v1/ingestion/sync-runs?providerId=${BALLDONTLIE_TEST_PROVIDER_ID}&sport=${Sport.HOCKEY}`, await createTestUser({ isRootAdmin: true })),
      ProviderSyncRunListResponseSchema,
    );

    expect(answered.syncRuns.map((run) => [run.sport, run.sportLeagueId])).toEqual([[Sport.HOCKEY, hockey]]);
  });
});
