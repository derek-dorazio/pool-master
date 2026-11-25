import { createEvent, getEventPage, listEventPages, listSportLeagues } from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { EventPageOfferState, Sport } from '@poolmaster/shared/domain';
import { EventPageListResponseSchema, EventPageResponseSchema } from '@poolmaster/shared/dto';
import { buildRegisteredUser, promoteToRootAdmin, inCurrentSeason } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma, getSdkClient } from './setup';
import { expectDefined } from '../support/expect-defined';

// The public event pages end to end over HTTP (#1007): a visitor with no session reads
// Championship Weekend once the NFL Playoffs have an edition, its bracket offer the primary one
// that dates the page, finds the page in the list and the upcoming list, and gets a 404 for an
// address no page has. Other suites create NFL events of their own, so the edition the page
// shows is not asserted here; which edition an offer shows is the event page service's unit tests'.

const YEAR = 2099;

/** The NFL Playoffs edition this run created. */
const createdEventIds: string[] = [];

afterAll(async () => {
  await cleanupFunctionalData();
  if (createdEventIds.length > 0) {
    const db = getFunctionalPrisma();
    const where = { sportEventId: { in: createdEventIds } };
    await db.sportEventRound.deleteMany({ where });
    await db.sportEventTier.deleteMany({ where });
    const events = await db.sportEvent.findMany({ where: { id: { in: createdEventIds } }, select: { eventSeriesId: true } });
    await db.sportEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    await db.eventSeries.deleteMany({ where: { id: { in: events.map((event) => event.eventSeriesId) }, sportEvents: { none: {} } } });
  }
  await disconnectFunctionalPrisma();
});

async function readPage(client: Client) {
  const response = await getEventPage({ client, path: { sportUrlSegment: 'american-football', urlSegment: 'championship-weekend' } });
  expect(response.response?.status).toBe(200);
  return EventPageResponseSchema.parse(response.data).eventPage;
}

describe('SDK Functional: event pages (#1007)', () => {
  it('shows a visitor Championship Weekend with the NFL bracket from the conference championships as its primary offer once the playoffs have an edition', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Event Page Editor' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const nflId = expectDefined(expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.AMERICAN_FOOTBALL } })).data).sportLeagues
      .find((league) => league.name === 'NFL')).id;
    const created = await createEvent({
      client: a,
      body: { sportLeagueId: await inCurrentSeason(nflId, YEAR), name: 'NFL Playoffs', startDate: `${YEAR}-01-10T18:00:00.000Z`, endDate: `${YEAR}-02-09T12:00:00.000Z`, rounds: 4, autoLifecycleEnabled: false },
    });
    expect(created.response?.status).toBe(201);
    createdEventIds.push(expectDefined(created.data).event.id);
    const visitor = getSdkClient();

    // --- The page: its bracket offer is the primary, starting at the conference championships --
    const page = await readPage(visitor);
    const primary = expectDefined(page.offers.find((offer) => offer.isPrimary));
    expect(primary).toMatchObject({ sportLeagueName: 'NFL', startsAtRound: 3, template: { templateKey: 'nfl-bracket-second-chance-doubling' } });
    expect([EventPageOfferState.NOT_YET, EventPageOfferState.OPEN]).toContain(primary.state);
    expect(page.offers.filter((offer) => offer.isPrimary)).toHaveLength(1);

    // --- The list carries the same page --------------------------------------------------------
    const list = EventPageListResponseSchema.parse((await listEventPages({ client: visitor, query: { sport: Sport.AMERICAN_FOOTBALL } })).data);
    expect(list.eventPages.find((listed) => listed.urlSegment === 'championship-weekend')?.offers.find((offer) => offer.isPrimary)?.template.templateKey)
      .toBe('nfl-bracket-second-chance-doubling');

    // --- The upcoming list: only pages with a primary edition coming, soonest first (#1202) ------
    const upcoming = EventPageListResponseSchema.parse((await listEventPages({ client: visitor, query: { sport: Sport.AMERICAN_FOOTBALL, upcoming: true } })).data);
    expect(upcoming.eventPages.map((listed) => listed.urlSegment)).toContain('championship-weekend');
    const starts = upcoming.eventPages.map((listed) => expectDefined(listed.offers.find((offer) => offer.isPrimary)).edition.startDate);
    expect(starts).toEqual([...starts].sort());
  });

  it('answers 404 EVENT_PAGE_NOT_FOUND for an address no page has', async () => {
    const response = await getEventPage({ client: getSdkClient(), path: { sportUrlSegment: 'basketball', urlSegment: 'championship-weekend' } });

    expect(response.response?.status).toBe(404);
    expect(response.error?.error.code).toBe('EVENT_PAGE_NOT_FOUND');
  });
});
