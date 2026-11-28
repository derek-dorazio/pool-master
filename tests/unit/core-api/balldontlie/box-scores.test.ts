import { z } from 'zod';
import { Sport, SportStat } from '../../../../packages/shared/domain';
import { BalldontlieAdapter } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { BOX_SCORE_ENDPOINTS } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/box-score-contract';
import { ProviderLeagueRefusedError, ProviderLeagueUnknownError } from '../../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { createFakeBalldontlie, type FakeBalldontlie, type FakeRoute } from '../../../support/balldontlie-fake-api';
import { contractGapsAgainst } from '../../../support/balldontlie-contract-gaps';
import { BALLDONTLIE_TEST_LEAGUES } from '../../../support/balldontlie-provider-rows';
import { describeErrors, loadVendorSpec, readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The adapter's box score reads (#2026) against a fake BALLDONTLIE that checks every request and
 * reply against each league's vendored document, and the box score contract held against those
 * documents. The vendor's stats endpoints need a paid plan and the document gives no response
 * examples for them, so every fixture (`<league>/box-scores.json`) is written to the document.
 */

const API_KEY = 'test-api-key';

interface LeagueCase {
  code: string;
  /** The vendored document the league's endpoint is in. */
  spec: string;
  sport: Sport;
  path: string;
  /** The vendor's schema component of one row, and the adapter's. */
  component: string;
  /** The fixture's first line, as the adapter reads it. */
  firstLine: { providerGameId: string; playerExternalId: string; playerName: string | null; stats: Array<{ stat: SportStat; value: number }> };
}

const LEAGUES: LeagueCase[] = [
  {
    code: 'nfl', spec: 'nfl', sport: Sport.FOOTBALL, path: '/nfl/v1/stats', component: 'NFLStats',
    firstLine: { providerGameId: '7001', playerExternalId: '33', playerName: 'Patrick Mahomes', stats: [
      { stat: SportStat.PASSING_TOUCHDOWNS, value: 3 }, { stat: SportStat.RUSHING_TOUCHDOWNS, value: 0 },
      { stat: SportStat.PASSING_YARDS, value: 291 }, { stat: SportStat.RUSHING_YARDS, value: 22 },
    ] },
  },
  {
    code: 'ncaaf', spec: 'ncaaf', sport: Sport.FOOTBALL, path: '/ncaaf/v1/player_stats', component: 'NCAAFPlayerStat',
    firstLine: { providerGameId: '9001', playerExternalId: '501', playerName: 'Arch Manning', stats: [
      { stat: SportStat.PASSING_TOUCHDOWNS, value: 2 }, { stat: SportStat.RUSHING_TOUCHDOWNS, value: 1 },
      { stat: SportStat.PASSING_YARDS, value: 310 }, { stat: SportStat.RUSHING_YARDS, value: 45 },
    ] },
  },
  {
    code: 'nba', spec: 'nba', sport: Sport.BASKETBALL, path: '/nba/v1/stats', component: 'NBAStats',
    firstLine: { providerGameId: '15001', playerExternalId: '175', playerName: 'Shai Gilgeous-Alexander', stats: [
      { stat: SportStat.POINTS, value: 31 }, { stat: SportStat.REBOUNDS, value: 5 }, { stat: SportStat.ASSISTS, value: 6 },
    ] },
  },
  {
    code: 'wnba', spec: 'wnba', sport: Sport.BASKETBALL, path: '/wnba/v1/player_stats', component: 'WNBAPlayerStat',
    firstLine: { providerGameId: '2101', playerExternalId: '301', playerName: 'A\'ja Wilson', stats: [
      { stat: SportStat.POINTS, value: 27 }, { stat: SportStat.REBOUNDS, value: 11 }, { stat: SportStat.ASSISTS, value: 3 },
    ] },
  },
  {
    code: 'ncaab', spec: 'ncaab', sport: Sport.BASKETBALL, path: '/ncaab/v1/player_stats', component: 'NCAABPlayerStat',
    firstLine: { providerGameId: '3301', playerExternalId: '4001', playerName: 'Cooper Flagg', stats: [
      { stat: SportStat.POINTS, value: 22 }, { stat: SportStat.REBOUNDS, value: 9 }, { stat: SportStat.ASSISTS, value: 4 },
    ] },
  },
  {
    code: 'ncaaw', spec: 'ncaaw', sport: Sport.BASKETBALL, path: '/ncaaw/v1/player_stats', component: 'NCAAWPlayerStat',
    firstLine: { providerGameId: '3401', playerExternalId: '5001', playerName: 'Paige Bueckers', stats: [
      { stat: SportStat.POINTS, value: 28 }, { stat: SportStat.REBOUNDS, value: 6 }, { stat: SportStat.ASSISTS, value: 5 },
    ] },
  },
  {
    code: 'nhl', spec: 'nhl', sport: Sport.HOCKEY, path: '/nhl/v1/box_scores', component: 'NHLBoxScore',
    firstLine: { providerGameId: '2025030411', playerExternalId: '8478402', playerName: 'Connor McDavid', stats: [
      { stat: SportStat.GOALS, value: 1 }, { stat: SportStat.ASSISTS, value: 2 }, { stat: SportStat.SHOTS_ON_GOAL, value: 5 },
    ] },
  },
  {
    code: 'mlb', spec: 'mlb', sport: Sport.BASEBALL, path: '/mlb/v1/stats', component: 'MLBStats',
    firstLine: { providerGameId: '5550001', playerExternalId: '660271', playerName: 'Shohei Ohtani', stats: [
      { stat: SportStat.TOTAL_BASES, value: 6 }, { stat: SportStat.RUNS, value: 2 }, { stat: SportStat.RUNS_BATTED_IN, value: 3 },
      { stat: SportStat.WALKS, value: 1 }, { stat: SportStat.STOLEN_BASES, value: 1 },
    ] },
  },
  {
    code: 'epl', spec: 'epl', sport: Sport.SOCCER, path: '/epl/v2/player_match_stats', component: 'SoccerPlayerMatchStats',
    firstLine: { providerGameId: '12001', playerExternalId: '901', playerName: null, stats: [
      { stat: SportStat.GOALS, value: 2 }, { stat: SportStat.ASSISTS, value: 0 }, { stat: SportStat.SHOTS_ON_TARGET, value: 4 },
    ] },
  },
  {
    code: 'worldcup', spec: 'fifa', sport: Sport.SOCCER, path: '/fifa/worldcup/v1/player_match_stats', component: 'FIFAPlayerMatchStats',
    firstLine: { providerGameId: '64001', playerExternalId: '701', playerName: null, stats: [
      { stat: SportStat.GOALS, value: 1 }, { stat: SportStat.ASSISTS, value: 1 }, { stat: SportStat.SHOTS_ON_TARGET, value: 3 },
    ] },
  },
];

const fixtureRows = (league: LeagueCase) => z.object({ data: z.array(z.record(z.string(), z.unknown())) }).parse(readBalldontlieFixture(league.spec, 'box-scores.json')).data;

/** The fixture's rows of the games the request names, as the vendor filters by its game ids parameter. */
function boxScoreRoute(league: LeagueCase): FakeRoute {
  const param = BOX_SCORE_ENDPOINTS[league.code].gameIdsParam;
  return ({ query }) => {
    const ids = new Set(query.getAll(param).map(Number));
    const rows = fixtureRows(league).filter((row) => {
      const game = row['game'] as { id?: number } | undefined;
      return ids.has(Number(game?.id ?? row['game_id'] ?? row['match_id']));
    });
    return { body: { data: rows, meta: { per_page: 100 } } };
  };
}

function setup(league: LeagueCase, route: FakeRoute = boxScoreRoute(league)): { adapter: BalldontlieAdapter; api: FakeBalldontlie; restore: () => void } {
  const api = createFakeBalldontlie({ league: league.spec, apiKey: API_KEY, routes: { [league.path]: route } });
  const originalFetch = global.fetch;
  global.fetch = api.fetch;
  const adapter = new BalldontlieAdapter({
    connection: () => ({ baseUrl: 'https://api.balldontlie.io', requestsPerMinute: 600 }),
    apiKey: API_KEY,
    leagues: BALLDONTLIE_TEST_LEAGUES,
    sleep: () => Promise.resolve(),
  });
  return {
    adapter,
    api,
    restore: () => {
      global.fetch = originalFetch;
      expect(api.violations).toEqual([]);
    },
  };
}

describe('BALLDONTLIE box score fixtures and contract', () => {
  it.each(LEAGUES)('$code: box-scores.json fits the vendor document\'s response schema for GET $path and parses with the adapter\'s', (league) => {
    const spec = loadVendorSpec(league.spec);
    const validate = spec.responseValidator(league.path);
    const valid = validate(readBalldontlieFixture(league.spec, 'box-scores.json'));
    expect(describeErrors(validate)).toBe('');
    expect(valid).toBe(true);
    const parsed = BOX_SCORE_ENDPOINTS[league.code].rowSchema.safeParse(fixtureRows(league)[0]);
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it.each(LEAGUES)('$code: every stat column read from $component is documented with a type the adapter accepts', (league) => {
    const spec = loadVendorSpec(league.spec);
    const ours = z.toJSONSchema(BOX_SCORE_ENDPOINTS[league.code].rowSchema, { io: 'input' }) as Record<string, unknown>;
    expect(contractGapsAgainst(spec, new Map())(ours, spec.component(league.component), league.component)).toEqual([]);
  });

  it('flags a stat column the vendor does not document, so a renamed column cannot be read as an empty stat', () => {
    const spec = loadVendorSpec('nba');
    const renamed = z.toJSONSchema(z.object({ points: z.number().int().optional() })) as Record<string, unknown>;
    expect(contractGapsAgainst(spec, new Map())(renamed, spec.component('NBAStats'), 'NBAStats')).toEqual([
      'NBAStats.points: the adapter reads it, but the vendor documents no such field',
    ]);
  });
});

describe('BalldontlieAdapter.getBoxScores', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it.each(LEAGUES)('$code: reads each player\'s line in the games asked for, with only the stats the vendor sent a value for', async (league) => {
    const harness = setup(league);
    restore = harness.restore;

    const lines = await harness.adapter.getBoxScores(league.sport, { providerLeagueCode: league.code, providerGameIds: [league.firstLine.providerGameId] });

    expect(lines[0]).toEqual(league.firstLine);
    expect(lines).toHaveLength(fixtureRows(league).length);
    expect(harness.api.requests.map((request) => request.path)).toEqual([league.path]);
  });

  it('asks for each game once, a page of games at a time', async () => {
    const nba = LEAGUES[2];
    const harness = setup(nba);
    restore = harness.restore;
    const ids = Array.from({ length: 150 }, (_, index) => String(20000 + index));

    await harness.adapter.getBoxScores(Sport.BASKETBALL, { providerLeagueCode: 'nba', providerGameIds: [...ids, ids[0]] });

    expect(harness.api.requests.map((request) => request.query.getAll('game_ids[]').length)).toEqual([100, 50]);
  });

  it('keeps a player who played no minutes, since a line of zeros is still the player\'s box score', async () => {
    const nba = LEAGUES[2];
    const harness = setup(nba);
    restore = harness.restore;

    const lines = await harness.adapter.getBoxScores(Sport.BASKETBALL, { providerLeagueCode: 'nba', providerGameIds: ['15001'] });

    expect(lines[1]).toMatchObject({ playerExternalId: '176', stats: [{ stat: SportStat.POINTS, value: 0 }, { stat: SportStat.REBOUNDS, value: 0 }, { stat: SportStat.ASSISTS, value: 0 }] });
  });

  it('leaves out a stat the vendor sends as null: a goalie has no goals row, not a zero', async () => {
    const nhl = LEAGUES[6];
    const harness = setup(nhl);
    restore = harness.restore;

    const lines = await harness.adapter.getBoxScores(Sport.HOCKEY, { providerLeagueCode: 'nhl', providerGameIds: ['2025030411'] });

    expect(lines[1]).toMatchObject({ playerExternalId: '8471679', stats: [] });
  });

  it('reads nothing when no game is asked for, and none for a league with no box scores', async () => {
    const harness = setup(LEAGUES[0]);
    restore = harness.restore;

    await expect(harness.adapter.getBoxScores(Sport.FOOTBALL, { providerLeagueCode: 'nfl', providerGameIds: [] })).resolves.toEqual([]);
    await expect(harness.adapter.getBoxScores(Sport.GOLF, { providerLeagueCode: 'pga', providerGameIds: ['1'] })).resolves.toEqual([]);
    expect(harness.api.requests).toHaveLength(0);
  });

  it('refuses a league code it does not read, reading nothing', async () => {
    const harness = setup(LEAGUES[0]);
    restore = harness.restore;

    await expect(harness.adapter.getBoxScores(Sport.FOOTBALL, { providerLeagueCode: 'cfl', providerGameIds: ['1'] })).rejects.toBeInstanceOf(ProviderLeagueUnknownError);
    expect(harness.api.requests).toHaveLength(0);
  });

  it('refuses a game id that is no vendor game id before reading anything', async () => {
    const harness = setup(LEAGUES[0]);
    restore = harness.restore;

    await expect(harness.adapter.getBoxScores(Sport.FOOTBALL, { providerLeagueCode: 'nfl', providerGameIds: ['nfl-7001'] })).rejects.toBeInstanceOf(BalldontlieContractError);
    expect(harness.api.requests).toHaveLength(0);
  });

  it('says the plan refuses the league when the stats read is refused, as the free plan refuses every stats endpoint', async () => {
    const harness = setup(LEAGUES[0], () => ({ status: 401, body: { error: 'Unauthorized' } }));
    restore = harness.restore;

    await expect(harness.adapter.getBoxScores(Sport.FOOTBALL, { providerLeagueCode: 'nfl', providerGameIds: ['7001'] })).rejects.toBeInstanceOf(ProviderLeagueRefusedError);
  });

  it('refuses a row that names no player, since its line cannot be placed', async () => {
    const harness = setup(LEAGUES[2], () => ({ body: { data: [{ pts: 3, game: { id: 15001, status_state: 'final' } }], meta: { per_page: 100 } } }));
    restore = harness.restore;

    await expect(harness.adapter.getBoxScores(Sport.BASKETBALL, { providerLeagueCode: 'nba', providerGameIds: ['15001'] })).rejects.toThrow('a box score row names no player');
  });
});
