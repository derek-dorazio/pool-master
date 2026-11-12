import { z } from 'zod';
import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieAdapter } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { createFakeBalldontlie, pagedRoute, type FakeBalldontlie, type FakeRoute } from '../../../support/balldontlie-fake-api';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The adapter's College Football Playoff reads against a fake BALLDONTLIE that checks every
 * request it sends, and every reply it is given, against the vendor's published NCAAF document
 * (see balldontlie-fake-api.ts). The replies are the fixtures in tests/fixtures/balldontlie/ncaaf.
 * Football's lists read the NFL too, which answers with its own fixtures.
 */

const API_KEY = 'test-api-key';
/** Mid-November 2026: the 2025 playoff is over and the 2026 one not yet started. */
const NOW = Date.UTC(2026, 10, 13);

const gameRow = z.looseObject({ id: z.number(), date: z.string() });
const gamesIn = (file: string) => z.object({ data: z.array(gameRow) }).parse(readBalldontlieFixture('ncaaf', file)).data;
const games = [...gamesIn('games-2025-season.json'), ...gamesIn('games-2026-season-partial.json')];

/**
 * Games as the vendor might filter them by date: on the UTC calendar date of the kickoff, both
 * bounds inclusive. So a Saturday night kickoff in the US is "on" the Sunday, and the adapter
 * must not count on the date filter alone to keep conference championship games out.
 */
const gamesRoute: FakeRoute = pagedRoute(games, (row, query) => {
  const day = row.date.slice(0, 10);
  const start = query.get('start_date');
  const end = query.get('end_date');
  return (start === null || day >= start) && (end === null || day <= end);
});

const defaultRoutes: Record<string, FakeRoute> = {
  '/ncaaf/v1/games': gamesRoute,
  '/ncaaf/v1/teams': () => ({ body: readBalldontlieFixture('ncaaf', 'teams.json') }),
  '/nfl/v1/games': () => ({ body: readBalldontlieFixture('nfl', 'games-2025-postseason.json') }),
  '/nfl/v1/teams': () => ({ body: readBalldontlieFixture('nfl', 'teams.json') }),
};

function setup(routes: Record<string, FakeRoute> = defaultRoutes, now = NOW): { adapter: BalldontlieAdapter; api: FakeBalldontlie; restore: () => void } {
  const api = createFakeBalldontlie({ league: ['ncaaf', 'nfl'], apiKey: API_KEY, routes });
  const originalFetch = global.fetch;
  global.fetch = api.fetch;
  let clock = now;
  const adapter = new BalldontlieAdapter({
    baseUrl: 'https://api.balldontlie.io',
    apiKey: API_KEY,
    requestsPerMinute: 600,
    now: () => clock,
    sleep: (ms) => { clock += ms; return Promise.resolve(); },
  });
  return {
    adapter,
    api,
    restore: () => {
      global.fetch = originalFetch;
      // Every request the adapter sent, and every reply it read, fitted the vendor document.
      expect(api.violations).toEqual([]);
    },
  };
}

const collegeRequests = (api: FakeBalldontlie) => api.requests
  .filter((request) => request.path.startsWith('/ncaaf/'))
  .map((request) => `${request.path}?${decodeURIComponent(request.query.toString())}`);

const gameIdsOf = (result: Awaited<ReturnType<BalldontlieAdapter['getLiveScores']>>) =>
  (result.category === 'GAME' ? result.games.map((game) => game.externalGameId) : []);

describe('BalldontlieAdapter (College Football Playoff)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  describe('getUpcomingEvents', () => {
    it('lists each season\'s playoff starting in the range beside the NFL\'s events, reading each season\'s window by date', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL, { from: new Date('2025-06-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') });

      expect(events.filter((event) => event.metadata.tour === 'CFP').map((event) => [event.externalId, event.name, event.status])).toEqual([
        ['ncaaf-2025-cfp', 'College Football Playoff', 'COMPLETED'],
        ['ncaaf-2026-cfp', 'College Football Playoff', 'IN_PROGRESS'],
      ]);
      expect(events.some((event) => event.externalId === 'nfl-2025-postseason')).toBe(true);
      expect(collegeRequests(harness.api)).toEqual([
        '/ncaaf/v1/games?start_date=2024-12-08&end_date=2025-02-01&per_page=100',
        '/ncaaf/v1/games?start_date=2025-12-07&end_date=2026-02-01&per_page=100',
        '/ncaaf/v1/games?start_date=2026-12-06&end_date=2027-02-01&per_page=100',
      ]);
    });

    it('reads the season under way and the next when the range is open-ended', async () => {
      const harness = setup();
      restore = harness.restore;

      await harness.adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL, { from: new Date('1900-01-01T00:00:00Z'), to: new Date('2999-12-31T00:00:00Z') });

      expect(collegeRequests(harness.api).map((line) => /start_date=(\d{4})/.exec(line)?.[1])).toEqual(['2026', '2027']);
    });

    it('takes the season just played as the one under way before March', async () => {
      const harness = setup(defaultRoutes, Date.UTC(2026, 0, 15));
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL);

      expect(collegeRequests(harness.api).map((line) => /start_date=(\d{4})/.exec(line)?.[1])).toEqual(['2025', '2026']);
      // Its window is still open in mid-January, so it is not over yet.
      expect(events.find((event) => event.externalId === 'ncaaf-2025-cfp')?.status).toBe('IN_PROGRESS');
    });
  });

  describe('getEventDetails', () => {
    it('gives a playoff with every team playing in its window, never the regular season\'s or conference title day\'s', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('ncaaf-2025-cfp');

      expect(detail).toMatchObject({ externalId: 'ncaaf-2025-cfp', sport: Sport.AMERICAN_FOOTBALL, participantCount: 14, status: 'COMPLETED' });
      expect(detail?.participants.map((team) => team.name)).not.toContain('Michigan Wolverines');
      expect(collegeRequests(harness.api)).toEqual(['/ncaaf/v1/games?start_date=2025-12-07&end_date=2026-02-01&per_page=100']);
    });

    it('gives nothing for a season the vendor has no game in yet', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getEventDetails('ncaaf-2027-cfp')).resolves.toBeNull();
    });
  });

  describe('getLiveScores', () => {
    it('never hands over the 2025 Big Ten title game between two playoff teams, which the date filter lets through, so it cannot link to a later playoff match', async () => {
      const harness = setup();
      restore = harness.restore;

      const result = await harness.adapter.getLiveScores('ncaaf-2025-cfp');

      expect(result).toMatchObject({ category: 'GAME', externalEventId: 'ncaaf-2025-cfp' });
      // The vendor's reply held it: it kicked off on the Sunday in UTC.
      expect(harness.api.requests).toHaveLength(1);
      expect(gameIdsOf(result)).not.toContain('5002');
      expect(gameIdsOf(result)).toEqual(['5003', '5011', '5012', '5013', '5014', '5021', '5022', '5023', '5024', '5031', '5032', '5041']);
    });

    it('gives a playoff under way its live and scheduled games, leaving out the season\'s own title game', async () => {
      const harness = setup();
      restore = harness.restore;

      const result = await harness.adapter.getLiveScores('ncaaf-2026-cfp');

      expect(result.category === 'GAME' ? result.games.map((game) => [game.externalGameId, game.state]) : []).toEqual([
        ['6011', ProviderGameState.IN_PROGRESS],
        ['6012', ProviderGameState.SCHEDULED],
      ]);
    });

    it('reads every page of the window\'s games', async () => {
      const [first] = gamesIn('games-2025-season.json').slice(2);
      const many = Array.from({ length: 101 }, (_, index) => ({ ...first, id: 900000 + index }));
      const harness = setup({ ...defaultRoutes, '/ncaaf/v1/games': pagedRoute(many) });
      restore = harness.restore;

      const result = await harness.adapter.getLiveScores('ncaaf-2025-cfp');

      expect(gameIdsOf(result)).toHaveLength(101);
      expect(harness.api.requests).toHaveLength(2);
    });
  });

  it('lists every college football team beside the NFL\'s, each toured CFP', async () => {
    const harness = setup();
    restore = harness.restore;

    const teams = await harness.adapter.getParticipants(Sport.AMERICAN_FOOTBALL);

    const college = teams.filter((team) => team.externalId.startsWith('ncaaf-team-'));
    expect(college.map((team) => team.name)).toEqual(['Indiana Hoosiers', 'Ohio State Buckeyes', 'Oregon Ducks', 'Miami Hurricanes', 'Navy Midshipmen']);
    expect(college.every((team) => team.metadata.tour === 'CFP')).toBe(true);
    expect(teams.some((team) => team.externalId.startsWith('nfl-team-'))).toBe(true);
    expect(collegeRequests(harness.api)).toEqual(['/ncaaf/v1/teams?']);
  });
});
