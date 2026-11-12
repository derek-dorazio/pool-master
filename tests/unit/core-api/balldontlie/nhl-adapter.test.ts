import { z } from 'zod';
import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieAdapter } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { createFakeBalldontlie, pagedRoute, type FakeBalldontlie, type FakeRoute } from '../../../support/balldontlie-fake-api';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The adapter's NHL reads against a fake BALLDONTLIE that checks every request it sends, and
 * every reply it is given, against the vendor's published NHL document (see
 * balldontlie-fake-api.ts). The replies are the fixtures in tests/fixtures/balldontlie/nhl.
 */

const API_KEY = 'test-api-key';
const NOW = Date.UTC(2026, 10, 10);

const gameRow = z.looseObject({ id: z.number(), season: z.number(), postseason: z.boolean() });
const gamesIn = (file: string) => z.object({ data: z.array(gameRow) }).parse(readBalldontlieFixture('nhl', file)).data;
const games = [...gamesIn('games-2024-postseason.json'), ...gamesIn('games-2025-postseason-partial.json')];
const teamRows = z.object({ data: z.array(z.looseObject({ id: z.number() })) }).parse(readBalldontlieFixture('nhl', 'teams.json')).data;

/** Games as the vendor filters them: by season, and by postseason when asked. */
const gamesRoute: FakeRoute = pagedRoute(games, (row, query) => {
  const seasons = query.getAll('seasons').map(Number);
  const postseason = query.get('postseason');
  return (seasons.length === 0 || seasons.includes(row.season)) && (postseason === null || String(row.postseason) === postseason);
});

const defaultRoutes: Record<string, FakeRoute> = {
  '/nhl/v1/games': gamesRoute,
  '/nhl/v1/teams': pagedRoute(teamRows),
};

function setup(routes: Record<string, FakeRoute> = defaultRoutes, now = NOW): { adapter: BalldontlieAdapter; api: FakeBalldontlie; restore: () => void } {
  const api = createFakeBalldontlie({ league: 'nhl', apiKey: API_KEY, routes });
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

const requestLine = (api: FakeBalldontlie) => api.requests.map((request) => `${request.path}?${decodeURIComponent(request.query.toString())}`);

describe('BalldontlieAdapter (NHL)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
  });

  describe('getUpcomingEvents', () => {
    it('lists each postseason starting in the range, reading the seasons whose playoffs fall in its years', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.HOCKEY, { from: new Date('2025-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') });

      expect(events.map((event) => [event.externalId, event.name, event.status, event.startDate.toISOString()])).toEqual([
        ['nhl-2024-postseason', 'NHL Playoffs', 'COMPLETED', '2025-04-19T00:00:00.000Z'],
        ['nhl-2025-postseason', 'NHL Playoffs', 'IN_PROGRESS', '2026-04-18T00:00:00.000Z'],
      ]);
      expect(requestLine(harness.api)).toEqual([
        '/nhl/v1/games?seasons=2024&postseason=true&per_page=100',
        '/nhl/v1/games?seasons=2025&postseason=true&per_page=100',
      ]);
    });

    it('leaves out a postseason that starts outside the range', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.HOCKEY, { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') });

      expect(events.map((event) => event.externalId)).toEqual(['nhl-2025-postseason']);
    });

    it('reads the season under way and the next when the range is open-ended, from September on', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getUpcomingEvents(Sport.HOCKEY, { from: new Date('1900-01-01T00:00:00Z'), to: new Date('2999-12-31T00:00:00Z') })).resolves.toEqual([]);
      expect(requestLine(harness.api).map((line) => /seasons=(\d+)/.exec(line)?.[1])).toEqual(['2026', '2027']);
    });

    it('takes the season whose playoffs are this spring as the one under way before September', async () => {
      const harness = setup(defaultRoutes, Date.UTC(2026, 4, 1));
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.HOCKEY);

      expect(events.map((event) => event.externalId)).toEqual(['nhl-2025-postseason']);
      expect(requestLine(harness.api).map((line) => /seasons=(\d+)/.exec(line)?.[1])).toEqual(['2025', '2026']);
    });
  });

  describe('getEventDetails', () => {
    it('gives a finished postseason with its sixteen teams, by the league\'s prefixed ids and tour', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('nhl-2024-postseason');

      expect(detail).toMatchObject({ externalId: 'nhl-2024-postseason', sport: Sport.HOCKEY, status: 'COMPLETED', participantCount: 16, fieldLocked: true });
      expect(detail?.participants[0]).toMatchObject({ externalId: 'nhl-team-1', name: 'Washington Capitals', metadata: { tour: 'NHL', abbreviation: 'WSH' } });
      expect(requestLine(harness.api)).toEqual(['/nhl/v1/games?seasons=2024&postseason=true&per_page=100']);
    });

    it('gives a postseason under way with the teams its games have so far', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getEventDetails('nhl-2025-postseason')).resolves.toMatchObject({ status: 'IN_PROGRESS', participantCount: 8 });
    });

    it('gives nothing for a postseason the vendor has no games in yet', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getEventDetails('nhl-2026-postseason')).resolves.toBeNull();
    });
  });

  it('lists every current NHL franchise as a hockey participant, reading every page, and leaves out a team in no conference', async () => {
    const harness = setup();
    restore = harness.restore;

    const teams = await harness.adapter.getParticipants(Sport.HOCKEY);

    expect(teams).toHaveLength(16);
    expect(teams.map((team) => team.externalId)).not.toContain('nhl-team-45');
    expect(teams[0]).toMatchObject({ externalId: 'nhl-team-1', name: 'Washington Capitals', sport: Sport.HOCKEY, metadata: { tour: 'NHL' } });
    expect(requestLine(harness.api)).toEqual(['/nhl/v1/teams?per_page=100']);
  });

  it('gives every game of a postseason in the GAME category, leaving out a game in an unknown state', async () => {
    const harness = setup();
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('nhl-2025-postseason');

    expect(result).toMatchObject({ category: 'GAME', externalEventId: 'nhl-2025-postseason' });
    expect(result.category === 'GAME' ? result.games.map((game) => [game.externalGameId, game.homeTeamExternalId, game.state, game.homeScore, game.awayScore]) : []).toEqual([
      ['2025030111', 'nhl-team-3', ProviderGameState.FINAL, 3, 2],
      ['2025030121', 'nhl-team-11', ProviderGameState.IN_PROGRESS, 1, 1],
      ['2025030131', 'nhl-team-15', ProviderGameState.SCHEDULED, null, null],
    ]);
  });

  it('reads every page of a postseason\'s games, so the writer counts every game of each series', async () => {
    const harness = setup();
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('nhl-2024-postseason');

    expect(result.category === 'GAME' ? result.games : []).toHaveLength(86);
    expect(harness.api.requests).toHaveLength(1);
    const many = Array.from({ length: 101 }, (_, index) => ({ ...games[0], id: 500000 + index }));
    const paged = setup({ ...defaultRoutes, '/nhl/v1/games': pagedRoute(many) });
    restore = () => { harness.restore(); paged.restore(); };
    const pagedResult = await paged.adapter.getLiveScores('nhl-2024-postseason');
    expect(pagedResult.category === 'GAME' ? pagedResult.games : []).toHaveLength(101);
    expect(paged.api.requests).toHaveLength(2);
  });
});
