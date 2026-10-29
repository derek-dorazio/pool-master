import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEvent, getEventPage, listEventPages, listSportLeagues } from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { EventPageOfferState, Sport } from '@poolmaster/shared/domain';
import { EventPageListResponseSchema, EventPageResponseSchema } from '@poolmaster/shared/dto';
import { LoadMode } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { parseSportDataFile, type SportDataFile } from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { buildRegisteredUser, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma, getSdkClient } from './setup';
import { expectDefined } from '../support/expect-defined';

// The public event pages end to end over HTTP (#1007): a visitor with no session reads
// Championship Weekend while its Clutch Card edition is still a draft (NOT_YET), then once the
// edition is loaded and released with its field (OPEN), finds the page in the list, and gets a
// 404 for an address no page has.

const RUN = `event-pages-${Date.now()}`;
const SEED = join(__dirname, '../../packages/core-api/scripts/seed-golf/american-football-2026-nfl-championships-test.json');
const YEAR = 2099;

let sportLeagueId = '';

/** Every event of the Championship Weekend sport league, and this run's players. */
async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  if (sportLeagueId !== '') {
    const series = { eventSeries: { sportLeagueId } };
    const where = { sportEvent: series };
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipant: where } });
    await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipant: where } });
    await db.sportEventParticipant.deleteMany({ where });
    await db.sportEventRound.deleteMany({ where });
    await db.sportEventTier.deleteMany({ where });
    await db.sportEvent.deleteMany({ where: series });
    await db.eventSeries.deleteMany({ where: { sportLeagueId } });
  }
  const participantIds = (await db.participant.findMany({ where: { externalId: { startsWith: RUN } }, select: { id: true } })).map((row) => row.id);
  await db.participantLeagueAffiliation.deleteMany({ where: { participantId: { in: participantIds } } });
  await db.participant.deleteMany({ where: { id: { in: participantIds } } });
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

/** The Conference Championships seed moved to a future season: its schedule, players and field, no results. */
function upcomingSeed(): SportDataFile {
  const file = parseSportDataFile(JSON.parse(readFileSync(SEED, 'utf8')) as unknown, { allowTestData: true });
  file.scope.season = YEAR;
  file.scope.sportLeagues = ['Championship Weekend'];
  file.scope.contents = file.scope.contents.filter((content) => ['SCHEDULE', 'PLAYERS', 'FIELDS'].includes(content));
  file.sportLeagues = file.sportLeagues.filter((league) => league.name === 'Championship Weekend');
  for (const league of file.sportLeagues) {
    for (const player of league.players) {
      player.key = `${RUN}-${player.key}`;
      player.name = `${player.name} ${RUN}`;
    }
    for (const event of league.events) {
      event.startDate = `${YEAR}-01-24`;
      event.endDate = `${YEAR}-01-24`;
      for (const entry of event.field) entry.player = `${RUN}-${entry.player}`;
      delete event.games;
    }
  }
  return file;
}

async function readPage(client: Client) {
  const response = await getEventPage({ client, path: { sport: Sport.AMERICAN_FOOTBALL, pageSlug: 'championship-weekend' } });
  expect(response.response?.status).toBe(200);
  return EventPageResponseSchema.parse(response.data).eventPage;
}

describe('SDK Functional: event pages (#1007)', () => {
  it('shows a visitor the Clutch Card as opening later while its edition is a draft, and as open once it is released with its field', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Event Page Editor' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    sportLeagueId = expectDefined(expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.AMERICAN_FOOTBALL } })).data).sportLeagues
      .find((league) => league.name === 'Championship Weekend')).id;
    await cleanup();
    const visitor = getSdkClient();

    // --- Between seasons: no Clutch Card edition, so no Clutch Card offer ----------------------
    expect((await readPage(visitor)).offers.some((offer) => offer.isPrimary)).toBe(false);

    // --- A draft edition: the offer shows when it is expected ---------------------------------
    const draft = await createEvent({
      client: a,
      body: { sportLeagueId, eventYear: YEAR, name: 'Conference Championships', startDate: `${YEAR}-01-24T20:00:00.000Z`, rounds: 1, autoLifecycleEnabled: false },
    });
    expect(draft.response?.status).toBe(201);
    const drafted = await readPage(visitor);
    expect(drafted.offers.find((offer) => offer.isPrimary)).toMatchObject({
      sportLeagueName: 'Championship Weekend',
      state: EventPageOfferState.NOT_YET,
      startsAtRound: null,
      edition: { sportEventId: expectDefined(draft.data).event.id, name: 'Conference Championships', eventYear: YEAR, startDate: `${YEAR}-01-24T20:00:00.000Z` },
      template: { templateKey: 'championship-weekend-tiered-redzone' },
    });
    await cleanup();

    // --- Released with its field: the offer is open -----------------------------------------
    await loadSportData(upcomingSeed(), { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.APPLY });
    const released = await readPage(visitor);
    expect(released.offers.find((offer) => offer.isPrimary)).toMatchObject({ state: EventPageOfferState.OPEN, edition: { eventYear: YEAR } });

    // --- The list carries the same page --------------------------------------------------------
    const list = EventPageListResponseSchema.parse((await listEventPages({ client: visitor, query: { sport: Sport.AMERICAN_FOOTBALL } })).data);
    expect(list.eventPages.find((page) => page.slug === 'championship-weekend')?.offers.find((offer) => offer.isPrimary)?.state).toBe(EventPageOfferState.OPEN);

    // --- The upcoming list: only pages with a primary edition coming, soonest first (#1202) ------
    const upcoming = EventPageListResponseSchema.parse((await listEventPages({ client: visitor, query: { sport: Sport.AMERICAN_FOOTBALL, upcoming: true } })).data);
    expect(upcoming.eventPages.map((page) => page.slug)).toContain('championship-weekend');
    const starts = upcoming.eventPages.map((page) => expectDefined(page.offers.find((offer) => offer.isPrimary)).edition.startDate);
    expect(starts).toEqual([...starts].sort());
  });

  it('answers 404 EVENT_PAGE_NOT_FOUND for an address no page has', async () => {
    const response = await getEventPage({ client: getSdkClient(), path: { sport: Sport.BASKETBALL, pageSlug: 'championship-weekend' } });

    expect(response.response?.status).toBe(404);
    expect(response.error?.error.code).toBe('EVENT_PAGE_NOT_FOUND');
  });
});
