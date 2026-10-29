/**
 * #1248 — the sport catalog's list reads cost the same SQL statements for 2 rows as for 20: the
 * sport leagues, and one sport league with its affiliations.
 *
 * Each case seeds sport leagues of its own beside the reference data the migrations seed, which
 * the list also shows. `rules/testing-rules.md` §9B *Query Scaling Tests* says when a route
 * needs one.
 */
import { randomUUID } from 'crypto';
import { Sport } from '@poolmaster/shared/domain';
import {
  ParticipantLeagueAffiliationListResponseSchema,
  SportLeagueListResponseSchema,
  SportLeagueResponseSchema,
} from '@poolmaster/shared/dto';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { DAY, get, okBody } from '../list-route-seeds';
import { expectConstantQueries } from '../query-scaling';

// No mocks.

// The public reads keep what they computed for a TTL; at 0 each read is its own, so the second
// run counts its read instead of being served the first run's.
const publicReadCacheTtl = process.env['PUBLIC_READ_CACHE_TTL_MS'];
beforeAll(async () => {
  process.env['PUBLIC_READ_CACHE_TTL_MS'] = '0';
  await setupIntegrationTests();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
  if (publicReadCacheTtl === undefined) delete process.env['PUBLIC_READ_CACHE_TTL_MS'];
  else process.env['PUBLIC_READ_CACHE_TTL_MS'] = publicReadCacheTtl;
});
beforeEach(() => cleanupTestData());

async function golf() {
  return getPrisma().sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
}

/** A golf sport league of its own, with `affiliations` golfers affiliated and ranked, and one event. */
async function seedSportLeague(affiliations: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const suffix = randomUUID().slice(0, 8);
  const sportLeague = await prisma.sportLeague.create({ data: { sportId: sport.id, name: `Scaling Catalog Tour ${suffix}` } });
  const series = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `Scaling Catalog Open ${suffix}` } });
  await prisma.sportEvent.create({
    data: {
      eventSeriesId: series.id, eventYear: new Date().getUTCFullYear(), externalId: `scaling-${suffix}`, providerId: 'integration-test',
      sport: Sport.GOLF, name: `Scaling Catalog Open ${suffix}`, startDate: new Date(Date.now() + 30 * DAY),
    },
  });
  for (let index = 0; index < affiliations; index += 1) {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name: `Affiliated Golfer ${suffix} ${String(index)}`, participantType: 'INDIVIDUAL', status: 'ACTIVE' },
    });
    await prisma.participantLeagueAffiliation.create({ data: { participantId: participant.id, sportLeagueId: sportLeague.id, ranking: index + 1 } });
  }
  return sportLeague;
}

/** A root admin, and `sportLeagues` golf sport leagues of their own, each with an affiliation and an event. */
async function seedSportLeagues(sportLeagues: number) {
  for (let index = 0; index < sportLeagues; index += 1) {
    await seedSportLeague(1);
  }
  return createTestUser({ isRootAdmin: true });
}

describe('sport catalog reads cost the same statements for 2 rows as for 20', () => {
  it('GET the sport leagues: the same statements for 2 sport leagues of their own as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/sport-leagues/',
      seed: seedSportLeagues,
      call: (rootAdmin) => get(`/api/v1/sport-leagues/?sport=${Sport.GOLF}`, rootAdmin),
      rowsShown: (response) => okBody(response, SportLeagueListResponseSchema).sportLeagues.length,
    });
  });

  it('GET a sport league: the same statements for 2 affiliated golfers as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/sport-leagues/{sportLeagueId}',
      seed: async (affiliations) => ({ sportLeague: await seedSportLeague(affiliations), rootAdmin: await createTestUser({ isRootAdmin: true }) }),
      call: ({ sportLeague, rootAdmin }) => get(`/api/v1/sport-leagues/${sportLeague.id}`, rootAdmin),
      rowsShown: (response) => okBody(response, SportLeagueResponseSchema).sportLeague.affiliationCount,
    });
  });

  it("GET a sport league's affiliations: the same statements for 2 affiliated golfers as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/sport-leagues/{sportLeagueId}/affiliations',
      seed: async (affiliations) => ({ sportLeague: await seedSportLeague(affiliations), rootAdmin: await createTestUser({ isRootAdmin: true }) }),
      call: ({ sportLeague, rootAdmin }) => get(`/api/v1/sport-leagues/${sportLeague.id}/affiliations`, rootAdmin),
      rowsShown: (response) => okBody(response, ParticipantLeagueAffiliationListResponseSchema).affiliations.length,
    });
  });
});
