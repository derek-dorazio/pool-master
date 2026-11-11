import { z } from 'zod';
import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieAdapter } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { createFakeBalldontlie, type FakeBalldontlie, type FakeRoute } from '../../../support/balldontlie-fake-api';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The adapter's NCAA men's basketball reads against a fake BALLDONTLIE that checks every request
 * it sends, and every reply it is given, against the vendor's published NCAAB document (see
 * balldontlie-fake-api.ts). The replies are the fixtures in tests/fixtures/balldontlie/ncaab.
 */

const API_KEY = 'test-api-key';
const NOW = Date.UTC(2026, 10, 10);

const bracketRow = z.looseObject({ season: z.number() });
type BracketRow = z.infer<typeof bracketRow>;
const bracketIn = (file: string) => z.object({ data: z.array(bracketRow) }).parse(readBalldontlieFixture('ncaab', file)).data;
const brackets = [...bracketIn('bracket-2025.json'), ...bracketIn('bracket-2026-partial.json')];

/** A season's bracket games as the vendor pages them: `cursor` is how many rows came before. */
function bracketRoute(rows: readonly BracketRow[]): FakeRoute {
  return ({ query }) => {
    const season = Number(query.get('season'));
    const selected = rows.filter((row) => row.season === season);
    const perPage = Number(query.get('per_page') ?? '25');
    const start = Number(query.get('cursor') ?? '0');
    const more = selected.length > start + perPage;
    return { body: { data: selected.slice(start, start + perPage), meta: { per_page: perPage, ...(more ? { next_cursor: start + perPage } : {}) } } };
  };
}

const defaultRoutes: Record<string, FakeRoute> = {
  '/ncaab/v1/bracket': bracketRoute(brackets),
  '/ncaab/v1/teams': () => ({ body: readBalldontlieFixture('ncaab', 'teams.json') }),
};

function setup(routes: Record<string, FakeRoute> = defaultRoutes, now = NOW): { adapter: BalldontlieAdapter; api: FakeBalldontlie; restore: () => void } {
  const api = createFakeBalldontlie({ league: 'ncaab', apiKey: API_KEY, routes });
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

describe('BalldontlieAdapter (NCAA men\'s basketball)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  describe('getUpcomingEvents', () => {
    it('lists each tournament starting in the range, reading the season that starts the year before', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.BASKETBALL, { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') });

      expect(events.map((event) => [event.externalId, event.name, event.status])).toEqual([
        ['ncaab-2025-tournament', 'NCAA Men\'s Tournament', 'COMPLETED'],
      ]);
      expect(requestLine(harness.api)).toEqual(['/ncaab/v1/bracket?season=2025&per_page=100']);
    });

    it('reads the last tournament and the next when the range is open-ended, not every season ever played', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.BASKETBALL, { from: new Date('1900-01-01T00:00:00Z'), to: new Date('2999-12-31T00:00:00Z') });

      expect(events.map((event) => event.externalId)).toEqual(['ncaab-2025-tournament', 'ncaab-2026-tournament']);
      expect(requestLine(harness.api).map((line) => /season=(\d+)/.exec(line)?.[1])).toEqual(['2025', '2026']);
    });

    it('takes the season that started last November as the one under way before the next November, and lists nothing for a season with no bracket', async () => {
      const harness = setup(defaultRoutes, Date.UTC(2026, 9, 31));
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.BASKETBALL);

      expect(events.map((event) => event.externalId)).toEqual(['ncaab-2025-tournament']);
      expect(requestLine(harness.api).map((line) => /season=(\d+)/.exec(line)?.[1])).toEqual(['2024', '2025']);
    });
  });

  describe('getEventDetails', () => {
    it('gives a tournament with every team its bracket has decided so far, each with its seed', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('ncaab-2025-tournament');

      expect(detail).toMatchObject({ externalId: 'ncaab-2025-tournament', sport: Sport.BASKETBALL, participantCount: 7, rounds: 6, status: 'COMPLETED' });
      expect(detail?.participants.find((team) => team.name === 'Duke Blue Devils')?.metadata).toEqual({ seed: 1 });
      expect(requestLine(harness.api)).toEqual(['/ncaab/v1/bracket?season=2025&per_page=100']);
    });

    it('gives nothing for a season whose bracket the vendor has not published', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getEventDetails('ncaab-2027-tournament')).resolves.toBeNull();
    });
  });

  it('lists every Division I team as a participant', async () => {
    const harness = setup();
    restore = harness.restore;

    const teams = await harness.adapter.getParticipants(Sport.BASKETBALL);

    expect(teams.map((team) => [team.externalId, team.name])).toEqual([
      ['ncaab-team-150', 'Duke Blue Devils'],
      ['ncaab-team-57', 'Florida Gators'],
      ['ncaab-team-2561', 'Siena Saints'],
    ]);
    expect(requestLine(harness.api)).toEqual(['/ncaab/v1/teams?']);
  });

  it('gives a tournament\'s game scores in the GAME category, under the tournament\'s id', async () => {
    const harness = setup();
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('ncaab-2026-tournament');

    expect(result).toMatchObject({ category: 'GAME', externalEventId: 'ncaab-2026-tournament' });
    expect(result.category === 'GAME' ? result.games.map((game) => [game.externalGameId, game.state]) : []).toEqual([
      ['401900101', ProviderGameState.FINAL],
      ['401900102', ProviderGameState.IN_PROGRESS],
      ['401900103', ProviderGameState.SCHEDULED],
    ]);
  });

  it('reads every page of a tournament\'s bracket', async () => {
    const [template] = bracketIn('bracket-2026-partial.json');
    const many = Array.from({ length: 101 }, (_, index) => ({ ...template, game_id: 600000 + index }));
    const harness = setup({ ...defaultRoutes, '/ncaab/v1/bracket': bracketRoute(many) });
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('ncaab-2026-tournament');

    expect(result.category === 'GAME' ? result.games : []).toHaveLength(101);
    expect(requestLine(harness.api)).toEqual([
      '/ncaab/v1/bracket?season=2026&per_page=100',
      '/ncaab/v1/bracket?season=2026&per_page=100&cursor=100',
    ]);
  });
});
