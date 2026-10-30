/**
 * #1316 — the public event pages cost the same SQL statements for 2 offers (or pages) as for 20.
 * Each offer used to read its series' editions, and then each edition's event, sports league,
 * sport and field count, on its own: about 6 statements an offer on every cache refill.
 *
 * The offers take the seeded Championship Weekend page's squares, bracket and Clutch Card offers in
 * turn, each on a series of its own with an edition next month, so every offer is shown and every
 * way of asking whether an offer could open is read with 2 offers and with 20. The pages
 * are kept by no cache here, so each run reads. `rules/testing-rules.md` §9B *Query Scaling
 * Tests* says when a route needs one.
 */
import { randomUUID } from 'crypto';
import { SelectionType, Sport, SportEventStatus } from '@poolmaster/shared/domain';
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

/**
 * The seeded Championship Weekend page's offers, squares first, then the bracket from the
 * conference round, then the Clutch Card. Each asks whether it could open its own way: squares by
 * the next game's kickoff, the bracket by its round's start and its games and field, the Clutch
 * Card by the event's start.
 */
async function championshipWeekendOffers() {
  const offers = await getPrisma().eventPageOffer.findMany({
    where: { eventPage: { sport: Sport.AMERICAN_FOOTBALL, slug: 'championship-weekend' } },
    include: { template: { select: { selectionType: true } } },
  });
  return [SelectionType.SQUARES, SelectionType.BRACKET, SelectionType.TIERED].map((selectionType) => {
    const offer = offers.find((each) => each.template.selectionType === selectionType);
    if (offer === undefined) throw new Error(`The Championship Weekend page has no ${selectionType} offer.`);
    return offer;
  });
}

/**
 * An active NFL page holding `offers` offers, taking the Championship Weekend offers in turn from
 * the `first`th, so 2 offers are already squares and a bracket. Each is on a series of its own
 * whose one edition is scheduled next month, with one game in the offer's starting round between
 * two teams of its own, so the squares offer has a kickoff and the bracket has games and a field.
 */
async function seedPage(offers: number, displayOrder: number, first = 0) {
  const prisma = getPrisma();
  const kinds = await championshipWeekendOffers();
  const football = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.AMERICAN_FOOTBALL } });
  const suffix = randomUUID().slice(0, 8);
  const page = await prisma.eventPage.create({
    data: { sport: Sport.AMERICAN_FOOTBALL, slug: `${SLUG_PREFIX}-${suffix}`, displayOrder },
  });
  const startDate = new Date(Date.now() + 30 * DAY);
  for (let sortOrder = 1; sortOrder <= offers; sortOrder += 1) {
    const { sportLeagueId, templateId, bracketStartRound } = kinds[(first + sortOrder - 1) % kinds.length];
    const roundNumber = bracketStartRound ?? 1;
    const eventSeriesName = `Scaling Weekend ${suffix} ${String(sortOrder)}`;
    const series = await prisma.eventSeries.create({ data: { sportLeagueId, name: eventSeriesName } });
    const event = await prisma.sportEvent.create({
      data: {
        eventSeriesId: series.id,
        eventYear: startDate.getUTCFullYear(),
        externalId: `scaling-weekend-${suffix}-${String(sortOrder)}`,
        providerId: 'integration-test',
        sport: Sport.AMERICAN_FOOTBALL,
        name: eventSeriesName,
        startDate,
        status: SportEventStatus.SCHEDULED,
        rounds: roundNumber,
      },
    });
    const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, roundNumber, scheduledDate: startDate } });
    const team = async (side: string) => {
      const participant = await prisma.participant.create({
        data: { sportId: football.id, name: `${side} ${suffix} ${String(sortOrder)}`, participantType: 'TEAM' },
      });
      return prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id, isActive: true } });
    };
    const [home, away] = [await team('Home'), await team('Away')];
    await prisma.sportEventMatch.create({
      data: {
        sportEventId: event.id,
        sportEventRoundId: round.id,
        matchNumber: 1,
        homeSportEventParticipantId: home.id,
        awaySportEventParticipantId: away.id,
        isNeutralSite: true,
        scheduledDate: startDate,
      },
    });
    await prisma.eventPageOffer.create({
      data: { eventPageId: page.id, sportLeagueId, eventSeriesName, templateId, bracketStartRound, sortOrder, isPrimary: sortOrder === 1 },
    });
  }
  return page;
}

describe('event pages cost the same statements for 2 offers as for 20', () => {
  it('GET the event page list: the same statements for 2 pages as for 20 (#1316)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/event-pages/',
      seed: async (pages) => {
        for (let index = 0; index < pages; index += 1) await seedPage(1, 1000 + index, index);
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
