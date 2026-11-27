import { z } from 'zod';
import { GameSideStatus, Sport } from '../../../../packages/shared/domain';
import { BalldontlieAdapter } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { ProviderLeagueRefusedError } from '../../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { createFakeBalldontlie, pagedRoute, type FakeBalldontlie, type FakeRoute } from '../../../support/balldontlie-fake-api';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';
import { BALLDONTLIE_TEST_LEAGUES } from '../../../support/balldontlie-provider-rows';

/**
 * The adapter's Formula 1 reads (#2045), against a fake BALLDONTLIE that checks every request it
 * sends, and every reply it is given, against the vendor's published F1 document (see
 * balldontlie-fake-api.ts). The replies are the fixtures in tests/fixtures/balldontlie/f1.
 */

const API_KEY = 'test-api-key';

const row = z.looseObject({ id: z.number() });
const rowsOf = (file: string) => z.object({ data: z.array(row) }).parse(readBalldontlieFixture('f1', file)).data;
const events = rowsOf('events-2025.json') as Array<z.infer<typeof row> & { season: number }>;
const sessions = rowsOf('sessions-2025.json') as Array<z.infer<typeof row> & { event: { id: number } }>;
const results = rowsOf('session-results-2025.json') as Array<z.infer<typeof row> & { session: { id: number } }>;

const idsIn = (query: URLSearchParams, name: string) => query.getAll(name).map(Number);

const defaultRoutes: Record<string, FakeRoute> = {
  '/f1/v1/events': pagedRoute(events, (event, query) => (!query.has('season') || event.season === Number(query.get('season')))
    && (!query.has('event_ids[]') || idsIn(query, 'event_ids[]').includes(event.id))),
  '/f1/v1/sessions': pagedRoute(sessions, (session, query) => idsIn(query, 'event_ids[]').includes(session.event.id)),
  '/f1/v1/session_results': pagedRoute(results, (result, query) => idsIn(query, 'session_ids[]').includes(result.session.id)),
  '/f1/v1/driver_standings': ({ query }) => ({ body: readBalldontlieFixture('f1', `driver-standings-${query.get('season') ?? ''}.json`) }),
  '/f1/v1/drivers': () => ({ body: readBalldontlieFixture('f1', 'drivers.json') }),
};

function setup(routes: Record<string, FakeRoute> = defaultRoutes): { adapter: BalldontlieAdapter; api: FakeBalldontlie; restore: () => void } {
  const api = createFakeBalldontlie({ league: 'f1', apiKey: API_KEY, routes });
  const originalFetch = global.fetch;
  global.fetch = api.fetch;
  let clock = Date.UTC(2025, 4, 20);
  const adapter = new BalldontlieAdapter({
    connection: () => ({ baseUrl: 'https://api.balldontlie.io', requestsPerMinute: 600 }),
    apiKey: API_KEY,
    leagues: BALLDONTLIE_TEST_LEAGUES,
    now: () => clock,
    sleep: (ms) => { clock += ms; return Promise.resolve(); },
  });
  return {
    adapter,
    api,
    restore: () => {
      global.fetch = originalFetch;
      expect(api.violations).toEqual([]);
    },
  };
}

const requestLines = (api: FakeBalldontlie) => api.requests.map((request) => `${request.path}?${decodeURIComponent(request.query.toString())}`);

describe('BalldontlieAdapter (Formula 1)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  describe('getUpcomingEvents', () => {
    it('lists a season\'s Grand Prix weekends, each its own slot code with every session the vendor lists, leaving out one with no start or an unclassifiable state', async () => {
      const harness = setup();
      restore = harness.restore;

      const listed = await harness.adapter.getUpcomingEvents(Sport.AUTO_RACING, undefined, { providerLeagueCode: 'f1', providerSeasonId: '2025' });

      expect(listed.map((event) => [event.externalId, event.name, event.status, event.venue, event.providerLeagueCode])).toEqual([
        ['f1-1108', 'Monaco Grand Prix', 'COMPLETED', 'Circuit de Monaco', 'f1'],
        ['f1-1124', 'Abu Dhabi Grand Prix', 'SCHEDULED', 'Yas Marina Circuit', 'f1'],
      ]);
      expect(listed[0].providerSlots).toEqual([{ code: 'f1-1108', startsAt: new Date('2025-05-23T11:30:00.000Z'), endsAt: new Date('2025-05-25T13:00:00.000Z') }]);
      expect(listed[1].sessions).toEqual([
        { providerSessionId: '5601', sessionType: 'Practice', startsAt: new Date('2025-12-05T09:30:00.000Z') },
        { providerSessionId: '5603', sessionType: 'Race', startsAt: new Date('2025-12-07T13:00:00.000Z') },
        { providerSessionId: '5604', sessionType: 'Sprint', startsAt: null },
      ]);
      expect(requestLines(harness.api)).toEqual([
        '/f1/v1/events?season=2025&per_page=100',
        '/f1/v1/sessions?event_ids[]=1108&event_ids[]=1124&per_page=100',
      ]);
    });

    it('reads nothing when no Season is named, never guessing a season from a date range', async () => {
      const harness = setup();
      restore = harness.restore;

      const listed = await harness.adapter.getUpcomingEvents(Sport.AUTO_RACING, { from: new Date('2025-01-01T00:00:00Z'), to: new Date('2025-12-31T00:00:00Z') }, { providerLeagueCode: 'f1' });

      expect(listed).toEqual([]);
      expect(harness.api.requests).toEqual([]);
    });

    it('reports the league refused when the plan does not include sessions, rather than listing weekends with none', async () => {
      const harness = setup({ ...defaultRoutes, '/f1/v1/sessions': () => ({ status: 401, body: { error: 'Unauthorized' } }) });
      restore = harness.restore;

      await expect(harness.adapter.getUpcomingEvents(Sport.AUTO_RACING, undefined, { providerLeagueCode: 'f1', providerSeasonId: '2025' }))
        .rejects.toBeInstanceOf(ProviderLeagueRefusedError);
    });
  });

  it('shows a weekend the vendor lists with no end, place or circuit as ending when it starts, at no venue, and a session with no start as unscheduled', async () => {
    const bare = events.map((event) => (event.id === 1124 ? { ...event, end_date: null, circuit: null, location: null, country_name: null } : event));
    const unscheduled = sessions.map((session) => (session.id === 5603 ? { ...session, date: null } : session));
    const harness = setup({
      ...defaultRoutes,
      '/f1/v1/events': pagedRoute(bare, (event, query) => !query.has('season') || event.season === Number(query.get('season'))),
      '/f1/v1/sessions': pagedRoute(unscheduled, (session, query) => idsIn(query, 'event_ids[]').includes(session.event.id)),
    });
    restore = harness.restore;

    const abuDhabi = (await harness.adapter.getUpcomingEvents(Sport.AUTO_RACING, undefined, { providerLeagueCode: 'f1', providerSeasonId: '2025' }))[1];
    const scores = await harness.adapter.getLiveScores('f1-1124');

    expect(abuDhabi).toMatchObject({ venue: undefined, location: undefined, startDate: new Date('2025-12-05T09:30:00.000Z'), endDate: new Date('2025-12-05T09:30:00.000Z') });
    if (scores.category !== 'RACE') throw new Error('expected RACE');
    expect(scores.sessions.map((session) => [session.providerSessionId, session.startsAt, session.runners])).toEqual([
      ['5601', '2025-12-05T09:30:00.000Z', []],
      ['5603', null, []],
      ['5604', null, []],
    ]);
  });

  describe('getEventDetails', () => {
    it('gives a weekend with its grid, each driver ranked by their place in the season\'s championship', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('f1-1108');

      expect(detail?.participants.map((driver) => [driver.externalId, driver.name, driver.ranking, driver.sport])).toEqual([
        ['31', 'Lando Norris', 1, Sport.AUTO_RACING],
        ['33', 'Oscar Piastri', 2, Sport.AUTO_RACING],
        ['32', 'Charles Leclerc', 5, Sport.AUTO_RACING],
        ['34', 'Lewis Hamilton', 6, Sport.AUTO_RACING],
      ]);
    });

    it('takes the grid from the season before while the new season has no standings yet', async () => {
      const next = events.map((event) => (event.id === 1124 ? { ...event, season: 2026 } : event));
      const harness = setup({ ...defaultRoutes, '/f1/v1/events': pagedRoute(next, (event, query) => idsIn(query, 'event_ids[]').includes(event.id)) });
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('f1-1124');

      expect(detail?.participants).toHaveLength(4);
      expect(requestLines(harness.api).filter((line) => line.startsWith('/f1/v1/driver_standings'))).toEqual([
        '/f1/v1/driver_standings?season=2026&per_page=100',
        '/f1/v1/driver_standings?season=2025&per_page=100',
      ]);
    });

    it('answers null for a weekend with no start yet, which cannot be shown, and names a driver with only a display name by it', async () => {
      const harness = setup({
        ...defaultRoutes,
        '/f1/v1/driver_standings': () => ({ body: { data: [{ id: 1, season: 2025, driver: { id: 40, first_name: null, last_name: null, display_name: 'Zhou Guanyu', country_name: null }, position: null }] } }),
      });
      restore = harness.restore;

      expect(await harness.adapter.getEventDetails('f1-1126')).toBeNull();
      const detail = await harness.adapter.getEventDetails('f1-1108');
      expect(detail?.participants).toEqual([expect.objectContaining({ externalId: '40', name: 'Zhou Guanyu', firstName: undefined, lastName: undefined, nationality: undefined, ranking: undefined })]);
    });

    it('reads nothing for an id that names no Grand Prix, such as a bare tournament number, and answers null for a weekend the vendor does not have', async () => {
      const harness = setup();
      restore = harness.restore;

      expect(await harness.adapter.getEventDetails('f1-999')).toBeNull();
      expect(await harness.adapter.getEventDetails('f1-x')).toBeNull();
      expect(requestLines(harness.api)).toEqual(['/f1/v1/events?event_ids[]=999']);
    });
  });

  describe('getLiveScores', () => {
    it('gives every session of the weekend with each driver\'s result: a place, a retirement as did not finish, and no place in a final session as did not start', async () => {
      const harness = setup();
      restore = harness.restore;

      const scores = await harness.adapter.getLiveScores('f1-1108');

      expect(scores.category).toBe('RACE');
      if (scores.category !== 'RACE') return;
      expect(scores.externalEventId).toBe('f1-1108');
      expect(scores.sessions.map((session) => [session.providerSessionId, session.sessionType, session.isOfficial, session.runners.length])).toEqual([
        ['5501', 'Practice', true, 0],
        ['5502', 'Qualifying', true, 2],
        ['5503', 'Race', true, 4],
      ]);
      expect(scores.sessions[2].runners).toEqual([
        { participantExternalId: '31', status: GameSideStatus.FINISHED, position: 1 },
        { participantExternalId: '32', status: GameSideStatus.FINISHED, position: 2 },
        { participantExternalId: '33', status: GameSideStatus.DID_NOT_FINISH, position: null },
        { participantExternalId: '34', status: GameSideStatus.DID_NOT_START, position: null },
      ]);
      expect(requestLines(harness.api)).toEqual([
        '/f1/v1/sessions?event_ids[]=1108&per_page=100',
        '/f1/v1/session_results?session_ids[]=5501&session_ids[]=5502&session_ids[]=5503&per_page=100',
      ]);
    });

    it('leaves out a driver with no place yet while the session is under way', async () => {
      const live = sessions.map((session) => (session.id === 5503 ? { ...session, status: 'Live', status_state: 'in_progress' } : session));
      const harness = setup({ ...defaultRoutes, '/f1/v1/sessions': pagedRoute(live, (session, query) => idsIn(query, 'event_ids[]').includes(session.event.id)) });
      restore = harness.restore;

      const scores = await harness.adapter.getLiveScores('f1-1108');

      if (scores.category !== 'RACE') throw new Error('expected RACE');
      expect(scores.sessions[2].isOfficial).toBe(false);
      expect(scores.sessions[2].runners.map((runner) => runner.participantExternalId)).toEqual(['31', '32', '33']);
    });
  });

  it('gives a weekend with no sessions listed yet no sessions, and reads no results for it', async () => {
    const harness = setup();
    restore = harness.restore;

    const scores = await harness.adapter.getLiveScores('f1-1125');

    expect(scores).toEqual({ category: 'RACE', externalEventId: 'f1-1125', sessions: [] });
    expect(requestLines(harness.api)).toEqual(['/f1/v1/sessions?event_ids[]=1125&per_page=100']);
  });

  it('lists every driver the vendor has as the sport\'s participants', async () => {
    const harness = setup();
    restore = harness.restore;

    const drivers = await harness.adapter.getParticipants(Sport.AUTO_RACING);

    expect(drivers.map((driver) => driver.name)).toEqual(['Lando Norris', 'Charles Leclerc', 'Oscar Piastri', 'Lewis Hamilton']);
  });
});
