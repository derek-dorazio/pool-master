import { z } from 'zod';
import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieAdapter } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { createFakeBalldontlie, pagedRoute, type FakeBalldontlie, type FakeRoute } from '../../../support/balldontlie-fake-api';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The adapter's WNBA playoffs reads against a fake BALLDONTLIE that checks every request it
 * sends, and every reply it is given, against the vendor's published WNBA document (see
 * balldontlie-fake-api.ts). The replies are the fixtures in tests/fixtures/balldontlie/wnba: the
 * 2025 season's games around its playoffs, Las Vegas champion, and the 2026 playoffs under way.
 * The basketball lists also read the NCAA tournaments and the NBA, served empty here.
 */

const API_KEY = 'test-api-key';
const NOW = Date.UTC(2026, 10, 12);

const gameRow = z.looseObject({ id: z.number(), season: z.number() });
const gamesIn = (file: string) => z.object({ data: z.array(gameRow) }).parse(readBalldontlieFixture('wnba', file)).data;
const games = [...gamesIn('games-2025.json'), ...gamesIn('games-2026-partial.json')];

/** Games as the vendor filters them: by season. */
const gamesRoute: FakeRoute = pagedRoute(games, (row, query) => {
  const seasons = query.getAll('seasons[]').map(Number);
  return seasons.length === 0 || seasons.includes(row.season);
});

const emptyPage: FakeRoute = () => ({ body: { data: [], meta: { per_page: 100 } } });
const emptyTeams: FakeRoute = () => ({ body: { data: [] } });

const defaultRoutes: Record<string, FakeRoute> = {
  '/wnba/v1/games': gamesRoute,
  '/wnba/v1/teams': () => ({ body: readBalldontlieFixture('wnba', 'teams.json') }),
  '/nba/v1/games': emptyPage,
  '/nba/v1/teams': emptyTeams,
  '/ncaab/v1/bracket': emptyPage,
  '/ncaab/v1/teams': emptyTeams,
  '/ncaaw/v1/bracket': emptyPage,
  '/ncaaw/v1/teams': emptyTeams,
};

function setup(routes: Record<string, FakeRoute> = defaultRoutes, now = NOW): { adapter: BalldontlieAdapter; api: FakeBalldontlie; restore: () => void } {
  const api = createFakeBalldontlie({ league: ['wnba', 'nba', 'ncaab', 'ncaaw'], apiKey: API_KEY, routes });
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

/** The WNBA requests sent, leaving out the NCAA and NBA reads the basketball lists also make. */
const requestLine = (api: FakeBalldontlie) => api.requests
  .filter((request) => request.path.startsWith('/wnba/'))
  .map((request) => `${request.path}?${decodeURIComponent(request.query.toString())}`);
const seasonsRead = (api: FakeBalldontlie) => requestLine(api).map((line) => /seasons\[\]=(\d+)/.exec(line)?.[1]);

describe('BalldontlieAdapter (WNBA playoffs)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  describe('getUpcomingEvents', () => {
    it('lists each season\'s playoffs starting in the range among basketball\'s events, leaving out regular season games', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.BASKETBALL, { from: new Date('2025-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') });

      expect(events.map((event) => [event.externalId, event.name, event.status, event.startDate.toISOString()])).toEqual([
        ['wnba-2025-postseason', 'WNBA Playoffs', 'COMPLETED', '2025-09-14T23:30:00.000Z'],
        ['wnba-2026-postseason', 'WNBA Playoffs', 'IN_PROGRESS', '2026-09-13T19:00:00.000Z'],
      ]);
      expect(requestLine(harness.api)).toEqual([
        '/wnba/v1/games?seasons[]=2025&per_page=100',
        '/wnba/v1/games?seasons[]=2026&per_page=100',
      ]);
    });

    it('reads this season and the next when the range is open-ended, from May on', async () => {
      const harness = setup();
      restore = harness.restore;

      await harness.adapter.getUpcomingEvents(Sport.BASKETBALL);

      expect(seasonsRead(harness.api)).toEqual(['2026', '2027']);
    });

    it('takes last year\'s season as the one under way before May', async () => {
      const harness = setup(defaultRoutes, Date.UTC(2026, 3, 1));
      restore = harness.restore;

      await harness.adapter.getUpcomingEvents(Sport.BASKETBALL);

      expect(seasonsRead(harness.api)).toEqual(['2025', '2026']);
    });
  });

  describe('getEventDetails', () => {
    it('gives a finished playoffs with its eight teams, by the league\'s prefixed ids and tour, and none of the regular season\'s', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('wnba-2025-postseason');

      expect(detail).toMatchObject({ externalId: 'wnba-2025-postseason', sport: Sport.BASKETBALL, status: 'COMPLETED', participantCount: 8, fieldLocked: true });
      expect(detail?.participants.map((team) => team.externalId)).not.toContain('wnba-team-3');
      expect(detail?.participants[0]).toMatchObject({ externalId: 'wnba-team-8', name: 'Minnesota Lynx', metadata: { tour: 'WNBA', abbreviation: 'MIN' } });
      expect(requestLine(harness.api)).toEqual(['/wnba/v1/games?seasons[]=2025&per_page=100']);
    });

    it('gives nothing for a season with no playoff game yet, however many regular season games it has', async () => {
      const harness = setup({ ...defaultRoutes, '/wnba/v1/games': pagedRoute(games.filter((game) => game['postseason'] === false)) });
      restore = harness.restore;

      await expect(harness.adapter.getEventDetails('wnba-2026-postseason')).resolves.toBeNull();
    });
  });

  it('lists every current WNBA franchise among basketball\'s participants, leaving out a team in no conference', async () => {
    const harness = setup();
    restore = harness.restore;

    const teams = await harness.adapter.getParticipants(Sport.BASKETBALL);

    expect(teams).toHaveLength(9);
    expect(teams.map((team) => team.externalId)).not.toContain('wnba-team-20');
    expect(teams[0]).toMatchObject({ externalId: 'wnba-team-8', name: 'Minnesota Lynx', sport: Sport.BASKETBALL, metadata: { tour: 'WNBA' } });
    expect(requestLine(harness.api)).toEqual(['/wnba/v1/teams?']);
  });

  it('gives every playoff game in the GAME category, holding back a score before tip-off and leaving out a game in an unknown state', async () => {
    const harness = setup();
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('wnba-2026-postseason');

    expect(result).toMatchObject({ category: 'GAME', externalEventId: 'wnba-2026-postseason' });
    expect(result.category === 'GAME' ? result.games.map((game) => [game.externalGameId, game.homeTeamExternalId, game.state, game.homeScore, game.awayScore]) : []).toEqual([
      ['4262001', 'wnba-team-8', ProviderGameState.FINAL, 91, 80],
      ['4262002', 'wnba-team-7', ProviderGameState.IN_PROGRESS, 44, 40],
      ['4262003', 'wnba-team-1', ProviderGameState.SCHEDULED, null, null],
    ]);
  });

  it('reads every page of a season\'s games, so the writer counts every game of each series', async () => {
    const many = Array.from({ length: 101 }, (_, index) => ({ ...gamesIn('games-2026-partial.json')[1], id: 700000 + index }));
    const harness = setup({ ...defaultRoutes, '/wnba/v1/games': pagedRoute(many) });
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('wnba-2026-postseason');

    expect(result.category === 'GAME' ? result.games : []).toHaveLength(101);
    expect(harness.api.requests).toHaveLength(2);
  });
});
