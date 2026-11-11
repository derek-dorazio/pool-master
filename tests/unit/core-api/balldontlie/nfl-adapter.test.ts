import { z } from 'zod';
import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieAdapter } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { createFakeBalldontlie, pagedRoute, type FakeBalldontlie, type FakeRoute } from '../../../support/balldontlie-fake-api';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The adapter's NFL reads against a fake BALLDONTLIE that checks every request it sends, and
 * every reply it is given, against the vendor's published NFL document (see
 * balldontlie-fake-api.ts). The replies are the fixtures in tests/fixtures/balldontlie/nfl.
 */

const API_KEY = 'test-api-key';
const NOW = Date.UTC(2026, 10, 10);

const gameRow = z.looseObject({ id: z.number(), season: z.number(), week: z.number(), postseason: z.boolean() });
const gamesIn = (file: string) => z.object({ data: z.array(gameRow) }).parse(readBalldontlieFixture('nfl', file)).data;
const games = [
  ...gamesIn('games-2026-week-12.json'),
  ...gamesIn('games-2025-postseason.json'),
  ...gamesIn('games-2026-postseason-partial.json'),
];

/** Games as the vendor filters them: by season, by week, and by season type (2 and 3 when none is sent). */
const gamesRoute: FakeRoute = pagedRoute(games, (row, query) => {
  const seasons = query.getAll('seasons[]').map(Number);
  const weeks = query.getAll('weeks[]').map(Number);
  const types = query.has('season_types[]') ? query.getAll('season_types[]').map(Number) : [2, 3];
  return (seasons.length === 0 || seasons.includes(row.season))
    && (weeks.length === 0 || weeks.includes(row.week))
    && types.includes(row.postseason ? 3 : 2);
});

const defaultRoutes: Record<string, FakeRoute> = {
  '/nfl/v1/games': gamesRoute,
  '/nfl/v1/teams': () => ({ body: readBalldontlieFixture('nfl', 'teams.json') }),
};

function setup(routes: Record<string, FakeRoute> = defaultRoutes): { adapter: BalldontlieAdapter; api: FakeBalldontlie; restore: () => void } {
  const api = createFakeBalldontlie({ league: 'nfl', apiKey: API_KEY, routes });
  const originalFetch = global.fetch;
  global.fetch = api.fetch;
  let now = NOW;
  const adapter = new BalldontlieAdapter({
    baseUrl: 'https://api.balldontlie.io',
    apiKey: API_KEY,
    requestsPerMinute: 600,
    now: () => now,
    sleep: (ms) => { now += ms; return Promise.resolve(); },
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

const requestLine = (api: FakeBalldontlie) => api.requests.map((request) => `${request.path}?${decodeURIComponent(request.query.toString())}`);

describe('BalldontlieAdapter (NFL)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    jest.restoreAllMocks();
    restore?.();
  });

  describe('getUpcomingEvents', () => {
    it('lists each week and each postseason starting in the range, reading the seasons it can fall in', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL, { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') });

      expect(events.map((event) => [event.externalId, event.name, event.status])).toEqual([
        ['nfl-2025-postseason', 'NFL Playoffs', 'COMPLETED'],
        ['nfl-2026-week-12', 'NFL Week 12', 'IN_PROGRESS'],
      ]);
      expect(requestLine(harness.api)).toEqual([
        '/nfl/v1/games?seasons[]=2025&season_types[]=2&season_types[]=3&per_page=100',
        '/nfl/v1/games?seasons[]=2026&season_types[]=2&season_types[]=3&per_page=100',
      ]);
    });

    it('reads the season under way and the next when the range is open-ended, not every season ever played', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL, { from: new Date('1900-01-01T00:00:00Z'), to: new Date('2999-12-31T00:00:00Z') });

      expect(events.map((event) => event.externalId)).toEqual(['nfl-2026-week-12', 'nfl-2026-postseason']);
      expect(requestLine(harness.api).map((line) => /seasons\[\]=(\d+)/.exec(line)?.[1])).toEqual(['2026', '2027']);
    });

    it('takes the season just ended as the one under way before March', async () => {
      const harness = setup();
      restore = harness.restore;
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2027, 1, 1));
      const adapter = new BalldontlieAdapter({ baseUrl: 'https://api.balldontlie.io', apiKey: API_KEY, requestsPerMinute: 600 });

      await adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL);

      expect(requestLine(harness.api).map((line) => /seasons\[\]=(\d+)/.exec(line)?.[1])).toEqual(['2026', '2027']);
    });

    it('lists nothing for a sport it does not cover', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getUpcomingEvents(Sport.HOCKEY)).resolves.toEqual([]);
      expect(harness.api.requests).toEqual([]);
    });
  });

  describe('getEventDetails', () => {
    it('gives a week with the teams playing in it, reading only that week\'s regular season games', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('nfl-2026-week-12');

      expect(detail).toMatchObject({ externalId: 'nfl-2026-week-12', sport: Sport.AMERICAN_FOOTBALL, participantCount: 8, rounds: 1 });
      expect(detail?.participants.map((team) => team.externalId)).toEqual(
        ['nfl-team-25', 'nfl-team-27', 'nfl-team-9', 'nfl-team-4', 'nfl-team-17', 'nfl-team-3', 'nfl-team-31', 'nfl-team-30'],
      );
      expect(requestLine(harness.api)).toEqual(['/nfl/v1/games?seasons[]=2026&season_types[]=2&weeks[]=12&per_page=100']);
    });

    it('gives a postseason with the teams its games have so far', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('nfl-2026-postseason');

      expect(detail).toMatchObject({ name: 'NFL Playoffs', status: 'IN_PROGRESS', participantCount: 5 });
      expect(requestLine(harness.api)).toEqual(['/nfl/v1/games?seasons[]=2026&season_types[]=3&per_page=100']);
    });

    it('gives nothing for a scope the vendor has no games in yet', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getEventDetails('nfl-2027-week-1')).resolves.toBeNull();
    });
  });

  it('lists every NFL team as a participant', async () => {
    const harness = setup();
    restore = harness.restore;

    const teams = await harness.adapter.getParticipants(Sport.AMERICAN_FOOTBALL);

    expect(teams).toHaveLength(14);
    expect(teams[0]).toMatchObject({ externalId: 'nfl-team-17', name: 'Kansas City Chiefs', sport: Sport.AMERICAN_FOOTBALL });
    expect(requestLine(harness.api)).toEqual(['/nfl/v1/teams?']);
  });

  it('lists no participants for a sport it does not cover', async () => {
    const harness = setup();
    restore = harness.restore;

    await expect(harness.adapter.getParticipants(Sport.HOCKEY)).resolves.toEqual([]);
  });

  it('gives a scope\'s game scores in the GAME category, under the scope\'s id', async () => {
    const harness = setup();
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('nfl-2026-week-12');

    expect(result).toMatchObject({ category: 'GAME', externalEventId: 'nfl-2026-week-12' });
    expect(result.category === 'GAME' ? result.games.map((game) => [game.externalGameId, game.state]) : []).toEqual([
      ['401201', ProviderGameState.FINAL],
      ['401202', ProviderGameState.IN_PROGRESS],
      ['401203', ProviderGameState.SCHEDULED],
    ]);
  });

  it('reads every page of a scope\'s games', async () => {
    const many = Array.from({ length: 101 }, (_, index) => ({ ...games[0], id: 500000 + index }));
    const harness = setup({ ...defaultRoutes, '/nfl/v1/games': pagedRoute(many) });
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('nfl-2026-week-12');

    expect(result.category === 'GAME' ? result.games : []).toHaveLength(101);
    expect(harness.api.requests).toHaveLength(2);
  });
});
