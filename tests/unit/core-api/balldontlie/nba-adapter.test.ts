import { z } from 'zod';
import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieAdapter } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { EventScoreSourceService } from '../../../../packages/core-api/src/modules/events/event-score-source-service';
import { registryWith } from '../../../support/fake-sport-data-provider';
import { asPrismaClient } from '../../../support/prisma-double';
import { createFakeBalldontlie, pagedRoute, type FakeBalldontlie, type FakeRoute } from '../../../support/balldontlie-fake-api';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The adapter's NBA playoffs reads against a fake BALLDONTLIE that checks every request it
 * sends, and every reply it is given, against the vendor's published NBA document (see
 * balldontlie-fake-api.ts). The replies are the fixtures in tests/fixtures/balldontlie/nba: the
 * 2025 Finals (the 2024 season's), Oklahoma City over Indiana in seven, the 2025 season's first
 * round under way, and a whole 2023 bracket written to the vendor's schema whose Finals (Boston v
 * Dallas) are two games in, with the third live, for a Clutch Card's box scores and stars (#1497).
 * Fixtures holding only a round's games read as that season's first round. The basketball lists
 * also read the NCAA tournaments, served empty here.
 */

const API_KEY = 'test-api-key';
const NOW = Date.UTC(2026, 10, 12);

const gameRow = z.looseObject({ id: z.number(), season: z.number(), postseason: z.boolean() });
const gamesIn = (file: string) => z.object({ data: z.array(gameRow) }).parse(readBalldontlieFixture('nba', file)).data;
const games = [...gamesIn('games-2024-finals.json'), ...gamesIn('games-2025-first-round-partial.json'), ...gamesIn('games-2023-playoffs.json')];

/** Games as the vendor filters them: by season, and by season type (every fixture is a playoff game). */
const gamesRoute: FakeRoute = pagedRoute(games, (row, query) => {
  const seasons = query.getAll('seasons[]').map(Number);
  return (seasons.length === 0 || seasons.includes(row.season)) && query.get('season_type') === 'playoffs';
});

const statRow = z.looseObject({ id: z.number(), game: z.looseObject({ id: z.number() }) });
const statRows = z.object({ data: z.array(statRow) }).parse(readBalldontlieFixture('nba', 'stats-2023-finals.json')).data;
const playerRow = z.looseObject({ id: z.number(), team: z.looseObject({ id: z.number() }) });
const activePlayers = z.object({ data: z.array(playerRow) }).parse(readBalldontlieFixture('nba', 'players-active-finals-teams.json')).data;

/** Stat rows as the vendor filters them, by game. */
const statsRoute: FakeRoute = pagedRoute(statRows, (row, query) => query.getAll('game_ids[]').map(Number).includes(row.game.id));
/** Active players as the vendor filters them, by team. */
const playersRoute: FakeRoute = pagedRoute(activePlayers, (row, query) => query.getAll('team_ids[]').map(Number).includes(row.team.id));

const emptyBracket: FakeRoute = () => ({ body: { data: [], meta: { per_page: 100 } } });
const emptyTeams: FakeRoute = () => ({ body: { data: [] } });

const defaultRoutes: Record<string, FakeRoute> = {
  '/nba/v1/games': gamesRoute,
  '/nba/v1/teams': () => ({ body: readBalldontlieFixture('nba', 'teams.json') }),
  '/nba/v1/stats': statsRoute,
  '/nba/v1/players/active': playersRoute,
  '/ncaab/v1/bracket': emptyBracket,
  '/ncaab/v1/teams': emptyTeams,
  '/ncaaw/v1/bracket': emptyBracket,
  '/ncaaw/v1/teams': emptyTeams,
};

function setup(routes: Record<string, FakeRoute> = defaultRoutes, now = NOW): { adapter: BalldontlieAdapter; api: FakeBalldontlie; restore: () => void } {
  const api = createFakeBalldontlie({ league: ['nba', 'ncaab', 'ncaaw'], apiKey: API_KEY, routes });
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

/** The NBA requests sent, leaving out the NCAA reads the basketball lists also make. */
const requestLine = (api: FakeBalldontlie) => api.requests
  .filter((request) => request.path.startsWith('/nba/'))
  .map((request) => `${request.path}?${decodeURIComponent(request.query.toString())}`);
const seasonsRead = (api: FakeBalldontlie) => requestLine(api).map((line) => /seasons\[\]=(\d+)/.exec(line)?.[1]);

describe('BalldontlieAdapter (NBA playoffs)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  describe('getUpcomingEvents', () => {
    it('lists each season\'s playoffs and each round it has reached starting in the range, reading the seasons whose playoffs fall in its years and only their playoff games', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.BASKETBALL, { from: new Date('2025-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') });

      expect(events.map((event) => [event.externalId, event.name, event.status, event.metadata])).toEqual([
        ['nba-2024-postseason', 'NBA Playoffs', 'COMPLETED', { tour: 'NBA', season: 2024 }],
        ['nba-2025-postseason', 'NBA Playoffs', 'IN_PROGRESS', { tour: 'NBA', season: 2025 }],
        ['nba-2024-postseason-round-1', 'NBA First Round', 'IN_PROGRESS', { tour: 'NBA First Round', season: 2024, round: 1 }],
        ['nba-2025-postseason-round-1', 'NBA First Round', 'IN_PROGRESS', { tour: 'NBA First Round', season: 2025, round: 1 }],
      ]);
      expect(requestLine(harness.api)).toEqual([
        '/nba/v1/games?seasons[]=2024&season_type=playoffs&per_page=100',
        '/nba/v1/games?seasons[]=2025&season_type=playoffs&per_page=100',
      ]);
    });

    it('leaves out playoffs read for the range\'s years whose first game starts outside it', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.BASKETBALL, { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') });

      expect(events.map((event) => event.externalId)).toEqual(['nba-2025-postseason', 'nba-2025-postseason-round-1']);
      expect(seasonsRead(harness.api)).toEqual(['2025']);
    });

    it('reads the season under way and the next when the range is open-ended, not every season ever played', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.BASKETBALL, { from: new Date('1900-01-01T00:00:00Z'), to: new Date('2999-12-31T00:00:00Z') });

      expect(events).toEqual([]);
      expect(seasonsRead(harness.api)).toEqual(['2026', '2027']);
    });

    it('takes the season that opened last autumn as the one under way before September, so its playoffs are read in spring', async () => {
      const harness = setup(defaultRoutes, Date.UTC(2026, 3, 20));
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.BASKETBALL);

      expect(events.map((event) => event.externalId)).toEqual(['nba-2025-postseason', 'nba-2025-postseason-round-1']);
      expect(seasonsRead(harness.api)).toEqual(['2025', '2026']);
    });
  });

  describe('getEventDetails', () => {
    it('gives a finished playoffs with both Finals teams, done once a side has won four of the last series', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('nba-2024-postseason');

      expect(detail).toMatchObject({
        externalId: 'nba-2024-postseason',
        sport: Sport.BASKETBALL,
        status: 'COMPLETED',
        fieldLocked: true,
        participantCount: 2,
        startDate: new Date('2025-06-06T00:30:00Z'),
        endDate: new Date('2025-06-23T00:30:00Z'),
      });
      expect(detail?.participants.map((team) => [team.externalId, team.name, team.metadata])).toEqual([
        ['nba-team-21', 'Oklahoma City Thunder', { abbreviation: 'OKC', conference: 'West', division: 'Northwest', tour: 'NBA' }],
        ['nba-team-12', 'Indiana Pacers', { abbreviation: 'IND', conference: 'East', division: 'Central', tour: 'NBA' }],
      ]);
      expect(requestLine(harness.api)).toEqual(['/nba/v1/games?seasons[]=2024&season_type=playoffs&per_page=100']);
    });

    it('gives a playoffs under way with the teams its games have so far, starting on the day of a game with no tip-off time yet', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('nba-2025-postseason');

      expect(detail).toMatchObject({ status: 'IN_PROGRESS', participantCount: 4, endDate: new Date('2026-04-21T00:00:00Z') });
    });

    it('gives nothing for a season whose playoffs have no game yet', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getEventDetails('nba-2026-postseason')).resolves.toBeNull();
    });
  });

  it('lists every NBA team as a participant alongside the NCAA teams', async () => {
    const harness = setup();
    restore = harness.restore;

    const teams = await harness.adapter.getParticipants(Sport.BASKETBALL);

    expect(teams).toHaveLength(8);
    expect(teams[0]).toMatchObject({ externalId: 'nba-team-21', name: 'Oklahoma City Thunder', sport: Sport.BASKETBALL, metadata: { tour: 'NBA' } });
    expect(requestLine(harness.api)).toEqual(['/nba/v1/teams?']);
  });

  it('gives every game of a playoffs in the GAME category, under the playoffs\' id, so the writer can count each series\' wins', async () => {
    const harness = setup();
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('nba-2024-postseason');

    expect(result).toMatchObject({ category: 'GAME', externalEventId: 'nba-2024-postseason' });
    const scores = result.category === 'GAME' ? result.games : [];
    expect(scores).toHaveLength(7);
    expect(scores[0]).toEqual({
      externalGameId: '18444001',
      homeTeamExternalId: 'nba-team-21',
      awayTeamExternalId: 'nba-team-12',
      state: ProviderGameState.FINAL,
      homeScore: 110,
      awayScore: 111,
    });
  });

  it('gives a game not yet under way no score, though the vendor shows it 0-0', async () => {
    const harness = setup();
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('nba-2025-postseason');

    expect(result.category === 'GAME' ? result.games.map((game) => [game.externalGameId, game.state, game.homeScore, game.awayScore]) : []).toEqual([
      ['18450001', ProviderGameState.FINAL, 112, 98],
      ['18450002', ProviderGameState.FINAL, 101, 108],
      ['18450003', ProviderGameState.IN_PROGRESS, 54, 49],
      ['18450004', ProviderGameState.SCHEDULED, null, null],
    ]);
  });

  it('reads every page of a season\'s playoff games', async () => {
    const many = Array.from({ length: 101 }, (_, index) => ({ ...games[0], id: 500000 + index }));
    const harness = setup({ ...defaultRoutes, '/nba/v1/games': pagedRoute(many) });
    restore = harness.restore;

    const result = await harness.adapter.getLiveScores('nba-2024-postseason');

    expect(result.category === 'GAME' ? result.games : []).toHaveLength(101);
    expect(harness.api.requests).toHaveLength(2);
  });

  it('refuses a game the vendor sends without the teams it is between, naming the game', async () => {
    // Sent as JSON, a side left undefined is a game with no `home_team` at all.
    const harness = setup({ ...defaultRoutes, '/nba/v1/games': pagedRoute([{ ...games[0], home_team: undefined }]) });
    restore = harness.restore;

    await expect(harness.adapter.getLiveScores('nba-2024-postseason')).rejects.toThrow('game 18444001 has no home_team');
  });
  describe('a playoff round, a Clutch Card\'s event (#1497)', () => {
    it('lists each round a season has reached, a round complete once its every series is decided, the Finals under way', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.BASKETBALL, { from: new Date('2024-01-01T00:00:00Z'), to: new Date('2024-12-31T23:59:59Z') });

      expect(events.map((event) => [event.externalId, event.name, event.status, event.fieldLocked])).toEqual([
        ['nba-2023-postseason', 'NBA Playoffs', 'IN_PROGRESS', true],
        ['nba-2023-postseason-round-1', 'NBA First Round', 'COMPLETED', true],
        ['nba-2023-postseason-round-2', 'NBA Conference Semifinals', 'COMPLETED', true],
        ['nba-2023-postseason-round-3', 'NBA Conference Finals', 'COMPLETED', true],
        ['nba-2023-postseason-round-4', 'NBA Finals', 'IN_PROGRESS', true],
      ]);
      expect(seasonsRead(harness.api)).toEqual(['2023']);
    });

    it('gives the Finals with both teams\' active players as its field under the round\'s tour, so they link to the NBA Finals league\'s stars, in one roster read for the two teams', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('nba-2023-postseason-round-4');

      expect(detail).toMatchObject({
        externalId: 'nba-2023-postseason-round-4',
        name: 'NBA Finals',
        startDate: new Date('2024-06-03T23:30:00.000Z'),
        participantCount: 5,
        metadata: { tour: 'NBA Finals', season: 2023, round: 4 },
      });
      expect(detail?.participants.map((player) => [player.externalId, player.name, player.metadata])).toEqual([
        ['nba-player-132', 'Luka Doncic', { position: 'G', team: 'Dallas Mavericks', tour: 'NBA Finals' }],
        ['nba-player-3202', 'Jayson Tatum', { position: 'F', team: 'Boston Celtics', tour: 'NBA Finals' }],
        ['nba-player-3547', 'Jaylen Brown', { position: 'G', team: 'Boston Celtics', tour: 'NBA Finals' }],
        ['nba-player-56677', 'Kyrie Irving', { position: 'G', team: 'Dallas Mavericks', tour: 'NBA Finals' }],
        ['nba-player-666786', 'Neemias Queta', { position: 'C', team: 'Boston Celtics', tour: 'NBA Finals' }],
      ]);
      expect(requestLine(harness.api)).toEqual([
        '/nba/v1/games?seasons[]=2023&season_type=playoffs&per_page=100',
        '/nba/v1/players/active?team_ids[]=2&team_ids[]=7&per_page=100',
      ]);
    });

    it('reads the rosters of all four teams of the conference finals\' two series', async () => {
      const harness = setup();
      restore = harness.restore;

      await harness.adapter.getEventDetails('nba-2023-postseason-round-3');

      expect(requestLine(harness.api)[1]).toMatch(/^\/nba\/v1\/players\/active\?(team_ids\[\]=\d+&){4}per_page=100$/);
    });

    it.each([
      ['NBA', ['nba-2023-postseason']],
      ['NBA Finals', ['nba-2023-postseason-round-4']],
      ['NBA Conference Finals', ['nba-2023-postseason-round-3']],
    ])('imports into the sport league keyed %s, by tour, only its own events of the year', async (matchKeyword, expected) => {
      const harness = setup();
      restore = harness.restore;
      const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue({ id: 'league', name: matchKeyword, matchKeyword, sport: { sport: Sport.BASKETBALL } }) } };
      const service = new EventScoreSourceService(asPrismaClient(prisma), registryWith(harness.adapter));

      const events = await service.listTourEventsForYear('balldontlie', 'league', 2024);

      expect(events.map((event) => event.externalId)).toEqual(expected);
    });

    it('gives nothing for a round no series has reached, without reading a roster', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getEventDetails('nba-2025-postseason-round-2')).resolves.toBeNull();
      expect(requestLine(harness.api)).toEqual(['/nba/v1/games?seasons[]=2025&season_type=playoffs&per_page=100']);
    });

    it('gives the Finals\' box scores in the STAT_LINE category, each game numbered within the series, reading the stats of only the games under way or done', async () => {
      const harness = setup();
      restore = harness.restore;

      const result = await harness.adapter.getLiveScores('nba-2023-postseason-round-4');

      expect(result).toMatchObject({ category: 'STAT_LINE', externalEventId: 'nba-2023-postseason-round-4' });
      const games = result.category === 'STAT_LINE' ? result.games : [];
      expect(games.map((game) => [game.externalGameId, game.gameNumber, game.state, game.lines.length])).toEqual([
        ['23900076', 1, ProviderGameState.FINAL, 4],
        ['23900077', 2, ProviderGameState.FINAL, 5],
        ['23900078', 3, ProviderGameState.IN_PROGRESS, 4],
        ['23900079', 4, ProviderGameState.SCHEDULED, 0],
      ]);
      expect(games[0].lines[0]).toEqual({
        participantExternalId: 'nba-player-3202',
        stats: [{ stat: 'POINTS', value: 22 }, { stat: 'REBOUNDS', value: 12 }, { stat: 'ASSISTS', value: 6 }],
      });
      expect(requestLine(harness.api)).toEqual([
        '/nba/v1/games?seasons[]=2023&season_type=playoffs&per_page=100',
        '/nba/v1/stats?game_ids[]=23900076&game_ids[]=23900077&game_ids[]=23900078&per_page=100',
      ]);
    });

    it('leaves out a player who sat a game out, listed with zero minutes, and keeps him the game he got in', async () => {
      const harness = setup();
      restore = harness.restore;

      const result = await harness.adapter.getLiveScores('nba-2023-postseason-round-4');

      const queta = (gameNumber: number) => (result.category === 'STAT_LINE' ? result.games : [])
        .find((game) => game.gameNumber === gameNumber)?.lines.find((line) => line.participantExternalId === 'nba-player-666786');
      expect(queta(1)).toBeUndefined();
      expect(queta(2)?.stats).toEqual([{ stat: 'POINTS', value: 2 }, { stat: 'REBOUNDS', value: 1 }, { stat: 'ASSISTS', value: 0 }]);
    });

    it('makes no stats read for a round with no game under way', async () => {
      const harness = setup();
      restore = harness.restore;

      const result = await harness.adapter.getLiveScores('nba-2025-postseason-round-2');

      expect(result).toEqual({ category: 'STAT_LINE', externalEventId: 'nba-2025-postseason-round-2', games: [] });
      expect(requestLine(harness.api)).toEqual(['/nba/v1/games?seasons[]=2025&season_type=playoffs&per_page=100']);
    });

    it('refuses a played stat row without the points Triple Threat scores, naming the player', async () => {
      const harness = setup({ ...defaultRoutes, '/nba/v1/stats': pagedRoute([{ ...statRows[0], pts: undefined }]) });
      restore = harness.restore;

      await expect(harness.adapter.getLiveScores('nba-2023-postseason-round-4')).rejects.toThrow('player 3202\'s stat row has no pts');
    });
  });
});
