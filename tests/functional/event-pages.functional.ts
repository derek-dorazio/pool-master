import { getEventPage, listEventPages, listSportLeagues } from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { EventPageOfferState, Sport } from '@poolmaster/shared/domain';
import { EventPageListResponseSchema, EventPageResponseSchema } from '@poolmaster/shared/dto';
import { buildRegisteredUser, promoteToRootAdmin, createTestEvent } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma, getSdkClient } from './setup';
import { putEventInSlot } from '../support/event-edition';
import { expectDefined } from '../support/expect-defined';

// The public event pages end to end over HTTP (#1007): a visitor with no session reads
// Championship Weekend once the NFL Playoffs fill its offer's slot, its bracket offer the primary one
// that dates the page, finds the page in the list and the upcoming list, and gets a 404 for an
// address no page has. Other suites create NFL events of their own, so the slot the page
// shows is not asserted here; which slot an offer shows is the event page service's unit tests'.

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
    await db.sportEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    await db.sportLeagueSeasonPhaseSlot.deleteMany({ where: { label: { in: createdEventIds.map((id) => `event ${id}`) } } });
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
    const created = await createTestEvent({
      client: a,
      body: { sportLeagueId: nflId, championshipYear: YEAR, name: 'NFL Playoffs', startDate: `${YEAR}-01-10T18:00:00.000Z`, endDate: `${YEAR}-02-09T12:00:00.000Z`, rounds: 4, autoLifecycleEnabled: false },
    });
    expect(created.response?.status).toBe(201);
    const eventId = expectDefined(created.data).event.id;
    createdEventIds.push(eventId);
    // The offer shows the next slot of its definition (#2010); until the sync gives events their
    // slots (slice 8), the test puts the playoffs in the offer's.
    const offered = await getFunctionalPrisma().eventPageOffer.findFirstOrThrow({
      where: { eventPage: { urlSegment: 'championship-weekend' }, isPrimary: true },
      select: { sportLeaguePhaseSlotId: true },
    });
    await putEventInSlot(getFunctionalPrisma(), eventId, offered.sportLeaguePhaseSlotId);
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
    const starts = upcoming.eventPages.map((listed) => expectDefined(listed.offers.find((offer) => offer.isPrimary)).nextSlot.startDate);
    expect(starts).toEqual([...starts].sort());
  });

  it('answers 404 EVENT_PAGE_NOT_FOUND for an address no page has', async () => {
    const response = await getEventPage({ client: getSdkClient(), path: { sportUrlSegment: 'basketball', urlSegment: 'championship-weekend' } });

    expect(response.response?.status).toBe(404);
    expect(response.error?.error.code).toBe('EVENT_PAGE_NOT_FOUND');
  });
});
