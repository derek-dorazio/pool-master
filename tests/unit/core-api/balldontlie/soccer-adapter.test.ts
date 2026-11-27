import { z } from 'zod';
import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieAdapter } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { createFakeBalldontlie, type FakeBalldontlie, type FakeRoute } from '../../../support/balldontlie-fake-api';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';
import { BALLDONTLIE_TEST_LEAGUES } from '../../../support/balldontlie-provider-rows';

/**
 * The adapter's soccer reads, the Premier League and the FIFA World Cup, against a fake
 * BALLDONTLIE that checks every request it sends, and every reply it is given, against the
 * vendor's published EPL and FIFA documents (see balldontlie-fake-api.ts). The replies are the
 * fixtures in tests/fixtures/balldontlie/epl and fifa.
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

const worldCupRow = z.looseObject({ season: z.object({ year: z.number() }) });
type WorldCupRow = z.infer<typeof worldCupRow>;
const worldCupMatches = ['matches-2022.json', 'matches-2026-partial.json']
  .flatMap((file) => z.object({ data: z.array(worldCupRow) }).parse(readBalldontlieFixture('fifa', file)).data);
/** The vendor's current edition, which the matches endpoint gives when no edition is named. */
const CURRENT_EDITION = 2026;

/** World Cup matches as the vendor pages them, for the editions asked (the current one when none is). */
function worldCupRoute(rows: readonly WorldCupRow[]): FakeRoute {
  return ({ query }) => {
    const asked = query.getAll('seasons[]').map(Number);
    const editions = asked.length === 0 ? [CURRENT_EDITION] : asked;
    const selected = rows.filter((row) => editions.includes(row.season.year));
    const perPage = Number(query.get('per_page') ?? '25');
    const start = Number(query.get('cursor') ?? '0');
    const more = selected.length > start + perPage;
    return { body: { data: selected.slice(start, start + perPage), meta: { per_page: perPage, ...(more ? { next_cursor: start + perPage } : {}) } } };
  };
}

const defaultRoutes: Record<string, FakeRoute> = {
  '/epl/v2/matches': matchesRoute(matches2026),
  '/epl/v2/teams': teamsRoute,
  '/fifa/worldcup/v1/matches': worldCupRoute(worldCupMatches),
  '/fifa/worldcup/v1/teams': () => ({ body: readBalldontlieFixture('fifa', 'teams.json') }),
};

function setup(routes: Record<string, FakeRoute> = defaultRoutes, now = NOW): { adapter: BalldontlieAdapter; api: FakeBalldontlie; restore: () => void } {
  const api = createFakeBalldontlie({ league: ['epl', 'fifa'], apiKey: API_KEY, routes });
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

const requestLine = (api: FakeBalldontlie) => api.requests.map((request) => `${request.path}?${decodeURIComponent(request.query.toString())}`);
/** One league's requests: soccer reads both leagues side by side, so theirs interleave. */
const requestsTo = (api: FakeBalldontlie, prefix: string) => requestLine(api).filter((line) => line.startsWith(prefix));
const eplRequests = (api: FakeBalldontlie) => requestsTo(api, '/epl/');
const worldCupRequests = (api: FakeBalldontlie) => requestsTo(api, '/fifa/');

describe('BalldontlieAdapter (soccer: the Premier League)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  describe('getUpcomingEvents', () => {
    it('lists each matchweek starting in the range, reading the seasons that start the year before to the year it ends', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.SOCCER, { from: new Date('2026-11-25T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') }, { providerLeagueCode: 'epl' });

      expect(events.map((event) => [event.externalId, event.name, event.status])).toEqual([
        ['epl-2026-matchweek-12', 'Premier League Matchweek 12', 'SCHEDULED'],
      ]);
      expect(eplRequests(harness.api)).toEqual([
        '/epl/v2/matches?season=2025&per_page=100',
        '/epl/v2/matches?season=2026&per_page=100',
      ]);
    });

    it('reads no season when neither a usable range nor a Season is named, rather than guessing one from the clock', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.SOCCER, { from: new Date('1900-01-01T00:00:00Z'), to: new Date('2999-12-31T00:00:00Z') }, { providerLeagueCode: 'epl' });

      expect(events).toEqual([]);
      expect(eplRequests(harness.api)).toEqual([]);
    });

    it('reads only the provider season it is asked for, whatever the clock says', async () => {
      const harness = setup(defaultRoutes, Date.UTC(2027, 5, 30));
      restore = harness.restore;

      await harness.adapter.getUpcomingEvents(Sport.SOCCER, undefined, { providerLeagueCode: 'epl', providerSeasonId: '2026' });

      expect(eplRequests(harness.api).map((line) => /season=(\d+)/.exec(line)?.[1])).toEqual(['2026']);
    });
  });

  describe('getEventDetails', () => {
    it('gives a matchweek with the teams playing in it, named from the season\'s teams, and its matches as scheduled', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('epl-2026-matchweek-11');

      expect(detail).toMatchObject({ externalId: 'epl-2026-matchweek-11', sport: Sport.SOCCER, rounds: 1, status: 'IN_PROGRESS' });
      expect(detail?.participants).toHaveLength(10);
      expect(detail?.participants.slice(0, 2).map((team) => [team.externalId, team.name])).toEqual([
        ['12', 'Manchester City'],
        ['9', 'Fulham'],
      ]);
      expect(detail?.games).toHaveLength(5);
      expect(detail?.games?.[0]).toMatchObject({ roundNumber: 1, homeTeamExternalId: '12', awayTeamExternalId: '9' });
      expect(detail?.games?.[0].games[0]?.providerGameId).toMatch(/^\d+$/);
      expect(detail?.games?.[0].scheduledAt).toBeInstanceOf(Date);
      expect(requestLine(harness.api)).toEqual(['/epl/v2/matches?season=2026&per_page=100', '/epl/v2/teams?season=2026']);
    });

    it('gives nothing for a matchweek the vendor has no match in, without reading the teams', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getEventDetails('epl-2026-matchweek-30')).resolves.toBeNull();
      expect(requestLine(harness.api)).toEqual(['/epl/v2/matches?season=2026&per_page=100']);
    });
  });

  it('lists the Premier League teams of the season under way, then the World Cup\'s current nations, as participants', async () => {
    const harness = setup();
    restore = harness.restore;

    const teams = await harness.adapter.getParticipants(Sport.SOCCER);

    expect(teams).toHaveLength(14);
    expect(teams[0]).toMatchObject({ externalId: '1', name: 'Arsenal', metadata: {} });
    expect(teams[10]).toMatchObject({ externalId: '9', name: 'Argentina', metadata: {} });
    expect([...requestLine(harness.api)].sort()).toEqual(['/epl/v2/teams?season=2026', '/fifa/worldcup/v1/teams?']);
  });

  it('gives a matchweek\'s match scores in the GAME category, under the matchweek\'s id', async () => {
    const harness = setup();
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('epl-2026-matchweek-11');

    expect(result).toMatchObject({ category: 'GAME', externalEventId: 'epl-2026-matchweek-11' });
    expect(result.category === 'GAME' ? result.games.map((game) => [game.providerGameId, game.state]) : []).toEqual([
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

describe('BalldontlieAdapter (soccer: the FIFA World Cup)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it('reads the vendor\'s current edition for a range, never an edition worked out from its years, and keeps only the brackets starting inside it', async () => {
    const harness = setup();
    restore = harness.restore;

    const inside = await harness.adapter.getUpcomingEvents(Sport.SOCCER, { from: new Date('2021-01-01T00:00:00Z'), to: new Date('2026-12-31T00:00:00Z') }, { providerLeagueCode: 'worldcup' });
    const outside = await harness.adapter.getUpcomingEvents(Sport.SOCCER, { from: new Date('2023-01-01T00:00:00Z'), to: new Date('2024-12-31T00:00:00Z') }, { providerLeagueCode: 'worldcup' });

    expect(inside.filter((event) => event.externalId.startsWith('fifa-')).map((event) => [event.externalId, event.status])).toEqual([
      ['fifa-wc-2026-knockout', 'IN_PROGRESS'],
    ]);
    expect(outside.filter((event) => event.externalId.startsWith('fifa-'))).toEqual([]);
    expect(worldCupRequests(harness.api)).toEqual(['/fifa/worldcup/v1/matches?per_page=100', '/fifa/worldcup/v1/matches?per_page=100']);
  });

  it('asks only for the edition a Season names', async () => {
    const harness = setup();
    restore = harness.restore;

    const named = await harness.adapter.getUpcomingEvents(Sport.SOCCER, undefined, { providerLeagueCode: 'worldcup', providerSeasonId: '2022' });
    expect(named.map((event) => event.externalId)).toEqual(['fifa-wc-2022-knockout']);
    expect(worldCupRequests(harness.api)).toEqual(['/fifa/worldcup/v1/matches?seasons[]=2022&per_page=100']);
  });

  it('keeps only the brackets starting inside a range when a Season names its edition', async () => {
    const harness = setup();
    restore = harness.restore;

    const options = { providerLeagueCode: 'worldcup', providerSeasonId: '2022' };
    const inside = await harness.adapter.getUpcomingEvents(Sport.SOCCER, { from: new Date('2022-01-01T00:00:00Z'), to: new Date('2022-12-31T00:00:00Z') }, options);
    const outside = await harness.adapter.getUpcomingEvents(Sport.SOCCER, { from: new Date('2023-01-01T00:00:00Z'), to: new Date('2023-12-31T00:00:00Z') }, options);

    expect(inside.map((event) => event.externalId)).toEqual(['fifa-wc-2022-knockout']);
    expect(outside).toEqual([]);
  });

  it('gives an edition\'s bracket with the teams decided so far, and nothing for an edition with no knockout match', async () => {
    const harness = setup();
    restore = harness.restore;

    const detail = await harness.adapter.getEventDetails('fifa-wc-2022-knockout');

    expect(detail).toMatchObject({ externalId: 'fifa-wc-2022-knockout', name: 'FIFA World Cup', status: 'COMPLETED' });
    expect(detail?.participants).toHaveLength(7);
    expect(detail?.participants.map((team) => team.name)).not.toContain('Qatar');
    expect(worldCupRequests(harness.api)).toEqual(['/fifa/worldcup/v1/matches?seasons[]=2022&per_page=100']);
    await expect(harness.adapter.getEventDetails('fifa-wc-2018-knockout')).resolves.toBeNull();
  });

  it('gives an edition\'s games and whole bracket once its round of 32 is set, from one read of its matches (#1728)', async () => {
    const knockoutMatches = z.object({ data: z.array(worldCupRow) }).parse(readBalldontlieFixture('fifa', 'matches-2026-knockout.json')).data;
    const harness = setup({ ...defaultRoutes, '/fifa/worldcup/v1/matches': worldCupRoute(knockoutMatches) });
    restore = harness.restore;

    const detail = await harness.adapter.getEventDetails('fifa-wc-2026-knockout');

    expect(detail).toMatchObject({ externalId: 'fifa-wc-2026-knockout', rounds: 5 });
    expect(detail?.participants).toHaveLength(32);
    expect(detail?.games).toHaveLength(16);
    expect(detail?.bracket).toHaveLength(31);
    expect(detail?.bracket?.[30]).toMatchObject({ roundNumber: 5, advancesTo: null });
    expect(worldCupRequests(harness.api)).toEqual(['/fifa/worldcup/v1/matches?seasons[]=2026&per_page=100']);
  });

  it('gives no bracket for an edition whose listing is partial, with its field still loaded', async () => {
    const harness = setup();
    restore = harness.restore;

    const detail = await harness.adapter.getEventDetails('fifa-wc-2026-knockout');

    expect(detail?.participants.length).toBeGreaterThan(0);
    expect(detail?.bracket).toBeUndefined();
    expect(detail?.games).toEqual([]);
  });

  it('gives a bracket\'s match scores in the GAME category, with the 2022 final\'s shoot-out', async () => {
    const harness = setup();
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('fifa-wc-2022-knockout');

    expect(result).toMatchObject({ category: 'GAME', externalEventId: 'fifa-wc-2022-knockout' });
    expect(result.category === 'GAME' ? result.games.find((game) => game.providerGameId === '2264') : undefined)
      .toMatchObject({ homeScore: 3, awayScore: 3, homeShootoutScore: 4, awayShootoutScore: 2 });
  });
});
