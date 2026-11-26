/**
 * #1316 — the public event pages cost the same SQL statements for 2 offers (or pages) as for 20.
 * Each offer used to read its series' editions, and then each edition's event, sports league,
 * sport and field count, on its own: about 6 statements an offer on every cache refill.
 *
 * The offers take the seeded NFL squares and bracket templates in turn, each on a series of its own with an edition next month, so every offer is shown and every
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
import { participantLeagueId } from '../../support/participant-league';
import { fixtureSeasonId, putEventInSlot, keyedSlotDefinitionId } from '../../support/event-edition';
import { SYNCED_SLOT_KEY_PREFIX, oneEventSlotId } from '../../support/test-slots';
import { createMatchRow } from '../../support/match-rows';

// No mocks.

/** The slugs this file's pages take, so they can be told from the seeded ones and removed. */
const URL_SEGMENT_PREFIX = 'query-scaling';

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
  return getPrisma().eventPage.deleteMany({ where: { urlSegment: { startsWith: URL_SEGMENT_PREFIX } } });
}

/**
 * The seeded NFL squares and bracket templates, squares first. Each asks whether it could open its
 * own way: squares by the next game's kickoff, the bracket by the event's start and its games and
 * field.
 */
async function nflOfferTemplates() {
  const templates = await getPrisma().contestConfigTemplate.findMany({
    where: { templateKey: { in: ['nfl-squares', 'nfl-bracket-doubling'] } },
    select: { id: true, sportLeagueId: true, selectionType: true },
  });
  return [SelectionType.SQUARES, SelectionType.BRACKET].map((selectionType) => {
    const template = templates.find((each) => each.selectionType === selectionType);
    if (template === undefined) throw new Error(`The NFL has no seeded ${selectionType} template.`);
    return { sportLeagueId: template.sportLeagueId, templateId: template.id };
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
  const kinds = await nflOfferTemplates();
  const football = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.FOOTBALL } });
  const suffix = randomUUID().slice(0, 8);
  const page = await prisma.eventPage.create({
    data: { sport: Sport.FOOTBALL, urlSegment: `${URL_SEGMENT_PREFIX}-${suffix}`, displayOrder },
  });
  const startDate = new Date(Date.now() + 30 * DAY);
  for (let sortOrder = 1; sortOrder <= offers; sortOrder += 1) {
    const { sportLeagueId, templateId } = kinds[(first + sortOrder - 1) % kinds.length];
    const roundNumber = 1;
    const name = `Scaling Weekend ${suffix} ${String(sortOrder)}`;
    const event = await prisma.sportEvent.create({
      data: {
        sportLeagueId: sportLeagueId,
        sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeagueId, startDate.getUTCFullYear()),
        name,
        startDate,
        status: SportEventStatus.SCHEDULED,
        rounds: roundNumber,
      },
    });
    const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId: await oneEventSlotId(prisma, event.id), roundNumber, scheduledDate: startDate } });
    const team = async (side: string) => {
      const participant = await prisma.participant.create({
        data: { sportLeagueId: await participantLeagueId(prisma, football.id), name: `${side} ${suffix} ${String(sortOrder)}`, participantType: 'TEAM' },
      });
      return prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id } });
    };
    const [home, away] = [await team('Home'), await team('Away')];
    await createMatchRow(prisma, {
      sportEventId: event.id, sportEventRoundId: round.id, sportEventSlotId: round.sportEventSlotId, matchNumber: 1,
      teams: [away.id, home.id], isNeutralSite: true, scheduledDate: startDate,
    });
    // Each offer shows the next slot of a definition of its own, the event's (#2010).
    const sportLeagueCompetitionSlotId = await keyedSlotDefinitionId(prisma, sportLeagueId, `${SYNCED_SLOT_KEY_PREFIX}SCALING_${suffix}_${String(sortOrder)}`.toUpperCase());
    await putEventInSlot(prisma, event.id, sportLeagueCompetitionSlotId);
    await prisma.eventPageOffer.create({
      data: { eventPageId: page.id, sportLeagueId, sportLeagueCompetitionSlotId, templateId, sortOrder, isPrimary: sortOrder === 1 },
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
      call: (viewer) => get(`/api/v1/event-pages/?sport=${Sport.FOOTBALL}`, viewer),
      rowsShown: (response) => okBody(response, EventPageListResponseSchema).eventPages
        .filter((page) => page.urlSegment.startsWith(URL_SEGMENT_PREFIX) && page.offers.length === 1).length,
    });
  });

  it('GET one event page: the same statements for 2 offers as for 20 (#1316)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/event-pages/{sportUrlSegment}/{urlSegment}',
      seed: async (offers) => ({ page: await seedPage(offers, 1000), viewer: await createTestUser() }),
      call: ({ page, viewer }) => get(`/api/v1/event-pages/football/${page.urlSegment}`, viewer),
      rowsShown: (response) => okBody(response, EventPageResponseSchema).eventPage.offers.length,
    });
  });
});
