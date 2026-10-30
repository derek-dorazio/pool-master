/**
 * #1316 — the public event pages cost the same SQL statements for 2 offers (or pages) as for 20.
 * Each offer used to read its series' editions, and then each edition's event, sports league,
 * sport and field count, on its own: about 6 statements an offer on every cache refill.
 *
 * Each offer is the seeded Championship Weekend page's primary offer (its contest setup and sports
 * league) on a series of its own with an edition next month, so every offer is shown. The pages
 * are kept by no cache here, so each run reads. `rules/testing-rules.md` §9B *Query Scaling
 * Tests* says when a route needs one.
 */
import { randomUUID } from 'crypto';
import { Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { EventPageListResponseSchema, EventPageResponseSchema } from '@poolmaster/shared/dto';
import { cleanupTestData, createTestUser, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { DAY, get, okBody } from '../list-route-seeds';
import { expectConstantQueries } from '../query-scaling';

// No mocks.

/** The slugs this file's pages take, so they can be told from the seeded ones and removed. */
const SLUG_PREFIX = 'query-scaling';

// Read once when the app is built: no copy of a page is kept, so each read below reaches the database.
process.env['PUBLIC_READ_CACHE_TTL_MS'] = '0';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await removeScalingPages();
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());
afterEach(() => removeScalingPages());

function removeScalingPages() {
  return getPrisma().eventPage.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
}

/** The seeded Championship Weekend page's primary offer: what every seeded offer here copies. */
async function championshipWeekendOffer() {
  return getPrisma().eventPageOffer.findFirstOrThrow({
    where: { isPrimary: true, eventPage: { sport: Sport.AMERICAN_FOOTBALL, slug: 'championship-weekend' } },
  });
}

/**
 * An active NFL page holding `offers` offers, each the Championship Weekend setup on a series of
 * its own whose one edition is scheduled next month.
 */
async function seedPage(offers: number, displayOrder: number) {
  const prisma = getPrisma();
  const { sportLeagueId, templateId } = await championshipWeekendOffer();
  const suffix = randomUUID().slice(0, 8);
  const page = await prisma.eventPage.create({
    data: { sport: Sport.AMERICAN_FOOTBALL, slug: `${SLUG_PREFIX}-${suffix}`, displayOrder },
  });
  const startDate = new Date(Date.now() + 30 * DAY);
  for (let sortOrder = 1; sortOrder <= offers; sortOrder += 1) {
    const eventSeriesName = `Scaling Weekend ${suffix} ${String(sortOrder)}`;
    const series = await prisma.eventSeries.create({ data: { sportLeagueId, name: eventSeriesName } });
    await prisma.sportEvent.create({
      data: {
        eventSeriesId: series.id,
        eventYear: startDate.getUTCFullYear(),
        externalId: `scaling-weekend-${suffix}-${String(sortOrder)}`,
        providerId: 'integration-test',
        sport: Sport.AMERICAN_FOOTBALL,
        name: eventSeriesName,
        startDate,
        status: SportEventStatus.SCHEDULED,
      },
    });
    await prisma.eventPageOffer.create({
      data: { eventPageId: page.id, sportLeagueId, eventSeriesName, templateId, sortOrder, isPrimary: sortOrder === 1 },
    });
  }
  return page;
}

describe('event pages cost the same statements for 2 offers as for 20', () => {
  it('GET the event page list: the same statements for 2 pages as for 20 (#1316)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/event-pages/',
      seed: async (pages) => {
        for (let index = 0; index < pages; index += 1) await seedPage(1, 1000 + index);
        return createTestUser();
      },
      call: (viewer) => get(`/api/v1/event-pages/?sport=${Sport.AMERICAN_FOOTBALL}`, viewer),
      rowsShown: (response) => okBody(response, EventPageListResponseSchema).eventPages
        .filter((page) => page.slug.startsWith(SLUG_PREFIX) && page.offers.length === 1).length,
    });
  });

  it('GET one event page: the same statements for 2 offers as for 20 (#1316)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/event-pages/{sport}/{pageSlug}',
      seed: async (offers) => ({ page: await seedPage(offers, 1000), viewer: await createTestUser() }),
      call: ({ page, viewer }) => get(`/api/v1/event-pages/${page.sport}/${page.slug}`, viewer),
      rowsShown: (response) => okBody(response, EventPageResponseSchema).eventPage.offers.length,
    });
  });
});
