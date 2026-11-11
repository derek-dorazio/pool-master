import { z } from 'zod';
import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieAdapter } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { createFakeBalldontlie, type FakeBalldontlie, type FakeRoute } from '../../../support/balldontlie-fake-api';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The adapter's Premier League reads against a fake BALLDONTLIE that checks every request it
 * sends, and every reply it is given, against the vendor's published EPL document (see
 * balldontlie-fake-api.ts). The replies are the fixtures in tests/fixtures/balldontlie/epl.
 */

const API_KEY = 'test-api-key';
const NOW = Date.UTC(2026, 10, 20);

const matchRow = z.looseObject({ season: z.number() });
type MatchRow = z.infer<typeof matchRow>;
const matches2026 = z.object({ data: z.array(matchRow) }).parse(readBalldontlieFixture('epl', 'matches-2026.json')).data;

/** A season's matches as the vendor pages them: `cursor` is how many rows came before. */
function matchesRoute(rows: readonly MatchRow[]): FakeRoute {
  return ({ query }) => {
    const season = Number(query.get('season'));
    const selected = rows.filter((row) => row.season === season);
    const perPage = Number(query.get('per_page') ?? '25');
    const start = Number(query.get('cursor') ?? '0');
    const more = selected.length > start + perPage;
    return { body: { data: selected.slice(start, start + perPage), meta: { per_page: perPage, ...(more ? { next_cursor: start + perPage } : {}) } } };
  };
}

/** The teams of 2026 only: another season's list is empty here. */
const teamsRoute: FakeRoute = ({ query }) => (query.get('season') === '2026'
  ? { body: readBalldontlieFixture('epl', 'teams-2026.json') }
  : { body: { data: [] } });

const defaultRoutes: Record<string, FakeRoute> = {
  '/epl/v2/matches': matchesRoute(matches2026),
  '/epl/v2/teams': teamsRoute,
};

function setup(routes: Record<string, FakeRoute> = defaultRoutes, now = NOW): { adapter: BalldontlieAdapter; api: FakeBalldontlie; restore: () => void } {
  const api = createFakeBalldontlie({ league: 'epl', apiKey: API_KEY, routes });
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

describe('BalldontlieAdapter (Premier League)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  describe('getUpcomingEvents', () => {
    it('lists each matchweek starting in the range, reading the seasons that start the year before to the year it ends', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.SOCCER, { from: new Date('2026-11-25T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') });

      expect(events.map((event) => [event.externalId, event.name, event.status])).toEqual([
        ['epl-2026-matchweek-12', 'Premier League Matchweek 12', 'SCHEDULED'],
      ]);
      expect(requestLine(harness.api)).toEqual([
        '/epl/v2/matches?season=2025&per_page=100',
        '/epl/v2/matches?season=2026&per_page=100',
      ]);
    });

    it('reads the season under way and the next when the range is open-ended, not every season ever played', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.SOCCER, { from: new Date('1900-01-01T00:00:00Z'), to: new Date('2999-12-31T00:00:00Z') });

      expect(events.map((event) => event.externalId)).toEqual(['epl-2026-matchweek-11', 'epl-2026-matchweek-12']);
      expect(requestLine(harness.api).map((line) => /season=(\d+)/.exec(line)?.[1])).toEqual(['2026', '2027']);
    });

    it('takes the season that started last summer as the one under way until the next July', async () => {
      const harness = setup(defaultRoutes, Date.UTC(2027, 5, 30));
      restore = harness.restore;

      await harness.adapter.getUpcomingEvents(Sport.SOCCER);

      expect(requestLine(harness.api).map((line) => /season=(\d+)/.exec(line)?.[1])).toEqual(['2026', '2027']);
    });
  });

  describe('getEventDetails', () => {
    it('gives a matchweek with the teams playing in it, named from the season\'s teams', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('epl-2026-matchweek-11');

      expect(detail).toMatchObject({ externalId: 'epl-2026-matchweek-11', sport: Sport.SOCCER, participantCount: 10, rounds: 1, status: 'IN_PROGRESS', metadata: { tour: 'EPL', season: 2026 } });
      expect(detail?.participants.slice(0, 2).map((team) => [team.externalId, team.name])).toEqual([
        ['epl-team-12', 'Manchester City'],
        ['epl-team-9', 'Fulham'],
      ]);
      expect(requestLine(harness.api)).toEqual(['/epl/v2/matches?season=2026&per_page=100', '/epl/v2/teams?season=2026']);
    });

    it('gives nothing for a matchweek the vendor has no match in, without reading the teams', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getEventDetails('epl-2026-matchweek-30')).resolves.toBeNull();
      expect(requestLine(harness.api)).toEqual(['/epl/v2/matches?season=2026&per_page=100']);
    });
  });

  it('lists the teams of the season under way as participants', async () => {
    const harness = setup();
    restore = harness.restore;

    const teams = await harness.adapter.getParticipants(Sport.SOCCER);

    expect(teams).toHaveLength(10);
    expect(teams[0]).toMatchObject({ externalId: 'epl-team-1', name: 'Arsenal', metadata: { tour: 'EPL' } });
    expect(requestLine(harness.api)).toEqual(['/epl/v2/teams?season=2026']);
  });

  it('gives a matchweek\'s match scores in the GAME category, under the matchweek\'s id', async () => {
    const harness = setup();
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('epl-2026-matchweek-11');

    expect(result).toMatchObject({ category: 'GAME', externalEventId: 'epl-2026-matchweek-11' });
    expect(result.category === 'GAME' ? result.games.map((game) => [game.externalGameId, game.state]) : []).toEqual([
      ['900111', ProviderGameState.FINAL],
      ['900112', ProviderGameState.FINAL],
      ['900113', ProviderGameState.IN_PROGRESS],
      ['900114', ProviderGameState.SCHEDULED],
      ['900115', ProviderGameState.POSTPONED],
    ]);
  });

  it('reads every page of a season\'s matches to find a matchweek', async () => {
    const [template] = matches2026;
    const many = Array.from({ length: 101 }, (_, index) => ({ ...template, id: 700000 + index }));
    const harness = setup({ ...defaultRoutes, '/epl/v2/matches': matchesRoute(many) });
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('epl-2026-matchweek-11');

    expect(result.category === 'GAME' ? result.games : []).toHaveLength(101);
    expect(requestLine(harness.api)).toEqual([
      '/epl/v2/matches?season=2026&per_page=100',
      '/epl/v2/matches?season=2026&per_page=100&cursor=100',
    ]);
  });
});
