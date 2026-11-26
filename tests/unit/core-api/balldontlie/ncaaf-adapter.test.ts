import { z } from 'zod';
import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieAdapter } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { createFakeBalldontlie, pagedRoute, type FakeBalldontlie, type FakeRoute } from '../../../support/balldontlie-fake-api';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';
import { BALLDONTLIE_TEST_LEAGUES } from '../../../support/balldontlie-provider-rows';

/**
 * The adapter's College Football Playoff reads against a fake BALLDONTLIE that checks every
 * request it sends, and every reply it is given, against the vendor's published NCAAF document
 * (see balldontlie-fake-api.ts). The replies are the fixtures in tests/fixtures/balldontlie/ncaaf.
 * Football's lists read the NFL too, which answers with its own fixtures.
 */

const API_KEY = 'test-api-key';
/** Mid-November 2026: the 2025 playoff is over and the 2026 one not yet started. */
const NOW = Date.UTC(2026, 10, 13);

const gameRow = z.looseObject({ id: z.number(), date: z.string(), season: z.number() });
const gamesIn = (file: string) => z.object({ data: z.array(gameRow) }).parse(readBalldontlieFixture('ncaaf', file)).data;
const games = [...gamesIn('games-2025-season.json'), ...gamesIn('games-2026-season-partial.json')];

/**
 * Games as the vendor filters them: by season, and by the UTC calendar date of the kickoff. A
 * Saturday night kickoff in the US is "on" the Sunday.
 */
const gamesRoute: FakeRoute = pagedRoute(games, (row, query) => {
  const seasons = query.getAll('seasons[]');
  const dates = query.getAll('dates[]');
  return (seasons.length === 0 || seasons.includes(String(row.season))) && (dates.length === 0 || dates.includes(row.date.slice(0, 10)));
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
      // Every request the adapter sent, and every reply it read, fitted the vendor document.
      expect(api.violations).toEqual([]);
    },
  };
}

const collegeRequests = (api: FakeBalldontlie) => api.requests
  .filter((request) => request.path.startsWith('/ncaaf/'))
  .map((request) => `${request.path}?${decodeURIComponent(request.query.toString())}`);

const gameIdsOf = (result: Awaited<ReturnType<BalldontlieAdapter['getLiveScores']>>) =>
  (result.category === 'GAME' ? result.games.map((game) => game.providerGameId) : []);

describe('BalldontlieAdapter (College Football Playoff)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  describe('getUpcomingEvents', () => {
    it('lists each season\'s playoff starting in the range, reading only college football and each season\'s games by season', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.FOOTBALL, { from: new Date('2025-06-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') }, { providerLeagueCode: 'ncaaf' });

      expect(events.map((event) => [event.externalId, event.name, event.status, event.providerLeagueCode])).toEqual([
        ['ncaaf-2025-cfp', 'College Football Playoff', 'COMPLETED', 'ncaaf'],
        ['ncaaf-2026-cfp', 'College Football Playoff', 'IN_PROGRESS', 'ncaaf'],
      ]);
      expect(harness.api.requests.some((request) => request.path.startsWith('/nfl/'))).toBe(false);
      expect(collegeRequests(harness.api)).toEqual([
        '/ncaaf/v1/games?seasons[]=2024&per_page=100',
        '/ncaaf/v1/games?seasons[]=2025&per_page=100',
        '/ncaaf/v1/games?seasons[]=2026&per_page=100',
      ]);
    });

    it('reads no season when neither a usable range nor a Season is named, rather than guessing one from the clock', async () => {
      const harness = setup();
      restore = harness.restore;

      await harness.adapter.getUpcomingEvents(Sport.FOOTBALL, { from: new Date('1900-01-01T00:00:00Z'), to: new Date('2999-12-31T00:00:00Z') }, { providerLeagueCode: 'ncaaf' });

      expect(collegeRequests(harness.api)).toEqual([]);
    });

    it('reads only the provider season it is asked for, whatever the clock says, every game of it a play for the sync to place by date window', async () => {
      const harness = setup(defaultRoutes, Date.UTC(2026, 0, 15));
      restore = harness.restore;

      const [event] = await harness.adapter.getUpcomingEvents(Sport.FOOTBALL, undefined, { providerLeagueCode: 'ncaaf', providerSeasonId: '2025' });

      expect(collegeRequests(harness.api)).toEqual(['/ncaaf/v1/games?seasons[]=2025&per_page=100']);
      expect(event.providerSlots).toHaveLength(gamesIn('games-2025-season.json').length);
      expect(event.providerSlots.every((play) => play.code === null)).toBe(true);
    });
  });

  describe('getEventDetails', () => {
    it('gives a playoff with the teams its season\'s games have and no field size, since the field is the seeds placed on it', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('ncaaf-2025-cfp');

      expect(detail).toMatchObject({ externalId: 'ncaaf-2025-cfp', sport: Sport.FOOTBALL, participantCount: undefined, status: 'COMPLETED' });
      expect(detail?.participants.map((team) => team.name)).toContain('Navy Midshipmen');
      expect(collegeRequests(harness.api)).toEqual(['/ncaaf/v1/games?seasons[]=2025&per_page=100']);
    });

    it('gives nothing for a season the vendor has no game in yet', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getEventDetails('ncaaf-2027-cfp')).resolves.toBeNull();
    });
  });

  describe('getLiveScores', () => {
    it('reads the games of yesterday, today and tomorrow in UTC, with their live and scheduled states, leaving out a game whose state is unknown', async () => {
      const harness = setup(defaultRoutes, Date.UTC(2026, 11, 19, 3));
      restore = harness.restore;

      const result = await harness.adapter.getLiveScores('ncaaf-2026-cfp');

      expect(result).toMatchObject({ category: 'GAME', externalEventId: 'ncaaf-2026-cfp' });
      expect(collegeRequests(harness.api)).toEqual(['/ncaaf/v1/games?dates[]=2026-12-18&dates[]=2026-12-19&dates[]=2026-12-20&per_page=100']);
      expect(result.category === 'GAME' ? result.games.map((game) => [game.providerGameId, game.state]) : []).toEqual([
        ['6011', ProviderGameState.IN_PROGRESS],
        ['6012', ProviderGameState.SCHEDULED],
      ]);
    });

    it('reads every page of the day\'s games', async () => {
      const [first] = gamesIn('games-2025-season.json').slice(2);
      const many = Array.from({ length: 101 }, (_, index) => ({ ...first, id: 900000 + index }));
      const harness = setup({ ...defaultRoutes, '/ncaaf/v1/games': pagedRoute(many) });
      restore = harness.restore;

      const result = await harness.adapter.getLiveScores('ncaaf-2025-cfp');

      expect(gameIdsOf(result)).toHaveLength(101);
      expect(harness.api.requests).toHaveLength(2);
    });
  });

  it('lists every college football team after the NFL\'s', async () => {
    const harness = setup();
    restore = harness.restore;

    const teams = await harness.adapter.getParticipants(Sport.FOOTBALL);

    expect(teams.slice(-5).map((team) => team.name)).toEqual(['Indiana Hoosiers', 'Ohio State Buckeyes', 'Oregon Ducks', 'Miami Hurricanes', 'Navy Midshipmen']);
    expect(teams.length).toBeGreaterThan(5);
    expect(collegeRequests(harness.api)).toEqual(['/ncaaf/v1/teams?']);
  });
});
