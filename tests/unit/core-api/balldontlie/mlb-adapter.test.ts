import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { MatchSide, ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieAdapter } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { createFakeBalldontlie, pagedRoute, type FakeBalldontlie, type FakeRoute } from '../../../support/balldontlie-fake-api';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';
import { fakeLogger } from '../../../support/fake-logger';
import { BALLDONTLIE_TEST_LEAGUES } from '../../../support/balldontlie-provider-rows';

/**
 * The adapter's MLB reads against a fake BALLDONTLIE that checks every request it sends, and
 * every reply it is given, against the vendor's published MLB document (see
 * balldontlie-fake-api.ts). The replies are the fixtures in tests/fixtures/balldontlie/mlb.
 */

const API_KEY = 'test-api-key';
const NOW = Date.UTC(2026, 10, 10);

const gameRow = z.looseObject({ id: z.number(), season: z.number(), postseason: z.boolean(), date: z.string() });
const gamesIn = (file: string) => z.object({ data: z.array(gameRow) }).parse(readBalldontlieFixture('mlb', file)).data;
const games = [...gamesIn('games-2025-postseason.json'), ...gamesIn('games-2026-postseason-partial.json')];

/** Games as the vendor filters them: by season, and by postseason when asked. */
const gamesRoute: FakeRoute = pagedRoute(games, (row, query) => {
  const seasons = query.getAll('seasons[]').map(Number);
  const postseason = query.get('postseason');
  return (seasons.length === 0 || seasons.includes(row.season)) && (postseason === null || String(row.postseason) === postseason);
});

const defaultRoutes: Record<string, FakeRoute> = {
  '/mlb/v1/games': gamesRoute,
  '/mlb/v1/teams': () => ({ body: readBalldontlieFixture('mlb', 'teams.json') }),
  // Only the 2025 season is ranked; any other season's standings are empty.
  '/mlb/v1/standings': ({ query }) => ({ body: query.get('season') === '2025' ? readBalldontlieFixture('mlb', 'standings-2025.json') : { data: [] } }),
};

function setup(routes: Record<string, FakeRoute> = defaultRoutes, now = NOW, logger?: FastifyBaseLogger): { adapter: BalldontlieAdapter; api: FakeBalldontlie; restore: () => void } {
  const api = createFakeBalldontlie({ league: 'mlb', apiKey: API_KEY, routes });
  const originalFetch = global.fetch;
  global.fetch = api.fetch;
  let clock = now;
  const adapter = new BalldontlieAdapter({
    connection: () => ({ baseUrl: 'https://api.balldontlie.io', requestsPerMinute: 600 }),
    apiKey: API_KEY,
    leagues: BALLDONTLIE_TEST_LEAGUES,
    now: () => clock,
    sleep: (ms) => { clock += ms; return Promise.resolve(); },
    ...(logger && { logger }),
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
const seasonsRead = (api: FakeBalldontlie) => requestLine(api).map((line) => /seasons\[\]=(\d+)/.exec(line)?.[1]);

describe('BalldontlieAdapter (MLB)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
  });

  describe('getUpcomingEvents', () => {
    it('lists each postseason starting in the range, reading the seasons of the years it covers, and no event per round of it', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.BASEBALL, { from: new Date('2025-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') });

      expect(events.map((event) => [event.externalId, event.name, event.status])).toEqual([
        ['mlb-2025-postseason', 'MLB Postseason', 'COMPLETED'],
        ['mlb-2026-postseason', 'MLB Postseason', 'IN_PROGRESS'],
      ]);
      expect(requestLine(harness.api)).toEqual([
        '/mlb/v1/games?seasons[]=2025&postseason=true&per_page=100',
        '/mlb/v1/games?seasons[]=2026&postseason=true&per_page=100',
      ]);
    });

    it('reads this season and the next when the range is open-ended, from March on', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.BASEBALL);

      expect(events.map((event) => event.externalId)).toEqual(['mlb-2026-postseason']);
      expect(seasonsRead(harness.api)).toEqual(['2026', '2027']);
    });

    it('takes last year\'s season as the one under way before March', async () => {
      const harness = setup(defaultRoutes, Date.UTC(2026, 1, 1));
      restore = harness.restore;

      await harness.adapter.getUpcomingEvents(Sport.BASEBALL);

      expect(seasonsRead(harness.api)).toEqual(['2025', '2026']);
    });
  });

  describe('getEventDetails', () => {
    it('gives a finished postseason with its twelve teams, by the league\'s prefixed ids and tour', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('mlb-2025-postseason');

      expect(detail).toMatchObject({ externalId: 'mlb-2025-postseason', sport: Sport.BASEBALL, status: 'COMPLETED', participantCount: 12, fieldLocked: true });
      expect(detail?.participants[0]).toMatchObject({ externalId: 'mlb-team-10', name: 'New York Yankees', metadata: { tour: 'MLB', abbreviation: 'NYY' } });
      expect(requestLine(harness.api)).toEqual(['/mlb/v1/games?seasons[]=2025&postseason=true&per_page=100', '/mlb/v1/standings?season=2025', '/mlb/v1/teams?']);
    });

    it('builds the bracket with each league\'s top two seeds waiting out the Wild Card Series, and puts them in the field before they play', async () => {
      // The Wild Card Series alone: Toronto, Seattle, Milwaukee and Philadelphia have no game yet.
      const wildCard = games.filter((game) => game.date < '2025-10-04');
      const harness = setup({ ...defaultRoutes, '/mlb/v1/games': pagedRoute(wildCard) });
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('mlb-2025-postseason');

      const team = (id: number) => `mlb-team-${String(id)}`;
      expect(detail?.participants.map((participant) => participant.externalId)).toEqual(expect.arrayContaining([team(14), team(25), team(19), team(22)]));
      expect(detail).toMatchObject({ participantCount: 12, rounds: 4 });
      // AL: New York 4 v Boston 5 and Cleveland 3 v Detroit 6; Toronto (1) and Seattle (2) wait. NL likewise.
      expect(detail?.bracket?.map((match) => [match.matchNumber, match.roundNumber, match.regionLabel, match.homeTeamExternalId, match.awayTeamExternalId, match.advancesTo])).toEqual([
        [1, 1, 'AL', team(10), team(2), { matchNumber: 5, side: MatchSide.AWAY }],
        [2, 1, 'AL', team(6), team(7), { matchNumber: 6, side: MatchSide.AWAY }],
        [3, 1, 'NL', team(16), team(24), { matchNumber: 7, side: MatchSide.AWAY }],
        [4, 1, 'NL', team(18), team(17), { matchNumber: 8, side: MatchSide.AWAY }],
        [5, 2, 'AL', team(14), null, { matchNumber: 9, side: MatchSide.HOME }],
        [6, 2, 'AL', team(25), null, { matchNumber: 9, side: MatchSide.AWAY }],
        [7, 2, 'NL', team(19), null, { matchNumber: 10, side: MatchSide.HOME }],
        [8, 2, 'NL', team(22), null, { matchNumber: 10, side: MatchSide.AWAY }],
        [9, 3, 'AL', null, null, { matchNumber: 11, side: MatchSide.HOME }],
        [10, 3, 'NL', null, null, { matchNumber: 11, side: MatchSide.AWAY }],
        [11, 4, null, null, null, null],
      ]);
      expect(detail?.games).toHaveLength(4);
    });

    it('builds no bracket, and adds no team, while the standings seed no league', async () => {
      const harness = setup({ ...defaultRoutes, '/mlb/v1/standings': () => ({ body: { data: [] } }) });
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('mlb-2025-postseason');

      expect(detail?.bracket).toBeUndefined();
      expect(detail?.games).toHaveLength(11);
      expect(requestLine(harness.api).filter((line) => line.startsWith('/mlb/v1/teams'))).toEqual([]);
    });

    it('still gives the field and every series as a game, with no bracket, when the plan does not include the teams list, and warns', async () => {
      const logger = fakeLogger();
      const harness = setup({ ...defaultRoutes, '/mlb/v1/teams': () => ({ status: 401, body: { error: 'Unauthorized' } }) }, NOW, logger);
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('mlb-2025-postseason');

      expect(detail).toMatchObject({ participantCount: 12, rounds: 4 });
      expect(detail?.games).toHaveLength(11);
      expect(detail?.bracket).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'balldontlie.playoffs.teamsRefused', league: 'mlb', season: 2025, status: 401 }),
        expect.any(String),
      );
      expect(logger.warn).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'balldontlie.playoffs.bracketUnplaced' }), expect.any(String));
    });

    it('fails the read when the teams list fails for any reason but the plan, so an outage still shows', async () => {
      const harness = setup({ ...defaultRoutes, '/mlb/v1/teams': () => ({ status: 400, body: { error: 'Bad request' } }) });
      restore = harness.restore;

      await expect(harness.adapter.getEventDetails('mlb-2025-postseason')).rejects.toThrow('/mlb/v1/teams');
    });

    it('warns that the bracket is left to an admin when the standings seed no league', async () => {
      const logger = fakeLogger();
      const harness = setup({ ...defaultRoutes, '/mlb/v1/standings': () => ({ body: { data: [] } }) }, NOW, logger);
      restore = harness.restore;

      await harness.adapter.getEventDetails('mlb-2025-postseason');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'balldontlie.playoffs.bracketUnplaced', league: 'mlb', season: 2025, rankedTeams: 0 }),
        expect.any(String),
      );
    });

    it('gives nothing for a postseason the vendor has no games in yet', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getEventDetails('mlb-2027-postseason')).resolves.toBeNull();
    });
  });

  it('lists every MLB team as a baseball participant', async () => {
    const harness = setup();
    restore = harness.restore;

    const teams = await harness.adapter.getParticipants(Sport.BASEBALL);

    expect(teams).toHaveLength(12);
    expect(teams[0]).toMatchObject({ externalId: 'mlb-team-14', name: 'Toronto Blue Jays', sport: Sport.BASEBALL, metadata: { tour: 'MLB', league: 'American' } });
    expect(requestLine(harness.api)).toEqual(['/mlb/v1/teams?']);
  });

  it('keeps only the asked season\'s postseason games even when the vendor ignores the season and postseason filters', async () => {
    const regularSeason = { ...games.find((row) => row.season === 2026), id: 5066999, postseason: false };
    const harness = setup({ ...defaultRoutes, '/mlb/v1/games': pagedRoute([...games, regularSeason]) });
    restore = harness.restore;

    const detail = await harness.adapter.getEventDetails('mlb-2026-postseason');
    const result = await harness.adapter.getLiveScores('mlb-2026-postseason');

    expect(detail).toMatchObject({ externalId: 'mlb-2026-postseason', status: 'IN_PROGRESS', participantCount: 8 });
    expect(result.category === 'GAME' ? result.games.map((game) => game.externalGameId) : []).toEqual(['5066001', '5066002', '5066003']);
  });

  it('gives every game of a postseason in the GAME category, runs as scores, leaving out a game in an unknown state', async () => {
    const harness = setup();
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('mlb-2026-postseason');

    expect(result).toMatchObject({ category: 'GAME', externalEventId: 'mlb-2026-postseason' });
    expect(result.category === 'GAME' ? result.games.map((game) => [game.externalGameId, game.homeTeamExternalId, game.state, game.homeScore, game.awayScore]) : []).toEqual([
      ['5066001', 'mlb-team-10', ProviderGameState.FINAL, 4, 1],
      ['5066002', 'mlb-team-18', ProviderGameState.IN_PROGRESS, 2, 2],
      ['5066003', 'mlb-team-22', ProviderGameState.SCHEDULED, null, null],
    ]);
  });

  it('reads every page of a postseason\'s games, so the writer counts every game of each series', async () => {
    const many = Array.from({ length: 101 }, (_, index) => ({ ...games[0], id: 600000 + index }));
    const harness = setup({ ...defaultRoutes, '/mlb/v1/games': pagedRoute(many) });
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('mlb-2025-postseason');

    expect(result.category === 'GAME' ? result.games : []).toHaveLength(101);
    expect(harness.api.requests).toHaveLength(2);
  });
});
