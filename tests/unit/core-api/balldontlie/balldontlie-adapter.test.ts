import { z } from 'zod';
import { ParticipantRoundStatus, Sport } from '../../../../packages/shared/domain';
import { BalldontlieAdapter } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { UnsupportedPgaFormatError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/pga-mapping';
import {
  BalldontlieSpecViolation,
  createFakeBalldontlie,
  pagedRoute,
  type FakeBalldontlie,
  type FakeRoute,
} from '../../../support/balldontlie-fake-api';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';
import { golfRoundsOf } from '../../../support/live-score-rounds';

/**
 * The adapter against a fake BALLDONTLIE that checks every request it sends, and every reply
 * it is given, against the vendor's published PGA document (see balldontlie-fake-api.ts). The
 * replies are the fixtures in tests/fixtures/balldontlie/pga.
 */

const API_KEY = 'test-api-key';

/** A fixture's rows, typed by the fields the fake's routes filter on and keeping every other field. */
const rowsOf = <Shape extends z.ZodRawShape>(file: string, shape: Shape) =>
  z.object({ data: z.array(z.looseObject({ id: z.number(), ...shape })) }).parse(readBalldontlieFixture('pga', file)).data;

const tournaments = rowsOf('tournaments-2026.json', { season: z.number() });
const competitors = rowsOf('tournament-competitors-41.json', { tournament_id: z.number(), type: z.string(), player: z.looseObject({ id: z.number() }) });
const players = rowsOf('players.json', { active: z.boolean() });
const liveResults = rowsOf('tournament-results-41-live.json', { tournament: z.looseObject({ id: z.number() }) });
const finalResults = rowsOf('tournament-results-40-final.json', { tournament: z.looseObject({ id: z.number() }) });

const byTournamentIds: FakeRoute = pagedRoute(tournaments, (row, query) => {
  const ids = query.getAll('tournament_ids[]').map(Number);
  const season = query.get('season');
  return (ids.length === 0 || ids.includes(row.id)) && (season === null || Number(season) === row.season);
});

const defaultRoutes: Record<string, FakeRoute> = {
  '/pga/v2/tournaments': byTournamentIds,
  '/pga/v2/tournament_competitors': pagedRoute(competitors, (row, query) =>
    row.tournament_id === Number(query.get('tournament_id'))
    && (!query.has('competitor_types[]') || query.getAll('competitor_types[]').includes(row.type))),
  '/pga/v1/players': pagedRoute(players, (row, query) => {
    const ids = query.getAll('player_ids[]').map(Number);
    return (ids.length === 0 || ids.includes(row.id)) && (query.get('active') !== 'true' || row.active);
  }),
  '/pga/v2/tournament_results': pagedRoute([...liveResults, ...finalResults], (row, query) =>
    row.tournament.id === Number(query.get('tournament_id'))),
};

function setup(routes: Record<string, FakeRoute> = defaultRoutes): { adapter: BalldontlieAdapter; api: FakeBalldontlie; restore: () => void } {
  const api = createFakeBalldontlie({ league: 'pga', apiKey: API_KEY, routes });
  const originalFetch = global.fetch;
  global.fetch = api.fetch;
  let now = 0;
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

const requestLine = (api: FakeBalldontlie) => api.requests.map((request) => `${request.path}?${request.query.toString()}`);

describe('BalldontlieAdapter (PGA TOUR)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it('identifies itself as the balldontlie provider covering golf, american football, basketball and soccer', () => {
    const harness = setup();
    restore = harness.restore;
    expect(harness.adapter.providerId).toBe('balldontlie');
    expect(harness.adapter.providerName).toBe('BALLDONTLIE');
    expect(harness.adapter.sportsCovered).toEqual([Sport.GOLF, Sport.AMERICAN_FOOTBALL, Sport.BASKETBALL, Sport.SOCCER, Sport.HOCKEY]);
  });

  describe('getUpcomingEvents', () => {
    it('reads each season a date range covers and keeps the tournaments starting inside it', async () => {
      const harness = setup();
      restore = harness.restore;

      const events = await harness.adapter.getUpcomingEvents(Sport.GOLF, {
        from: new Date('2026-08-01T00:00:00Z'),
        to: new Date('2026-08-31T23:59:59Z'),
      });

      expect(events.map((event) => [event.externalId, event.name, event.status])).toEqual([
        ['40', 'Wyndham Championship', 'COMPLETED'],
        ['41', 'BMW Championship', 'IN_PROGRESS'],
        ['42', 'TOUR Championship', 'SCHEDULED'],
      ]);
      expect(requestLine(harness.api)).toEqual(['/pga/v2/tournaments?season=2026&include_format=true&per_page=100']);
    });

    it('reads one season at a time across a year boundary', async () => {
      const harness = setup();
      restore = harness.restore;

      await harness.adapter.getUpcomingEvents(Sport.GOLF, { from: new Date('2025-12-01T00:00:00Z'), to: new Date('2026-01-31T00:00:00Z') });

      expect(requestLine(harness.api)).toEqual([
        '/pga/v2/tournaments?season=2025&include_format=true&per_page=100',
        '/pga/v2/tournaments?season=2026&include_format=true&per_page=100',
      ]);
    });

    it('reads every season in one list when there is no range or the range is open-ended, leaving out tournaments of unknown state', async () => {
      const harness = setup();
      restore = harness.restore;

      const all = await harness.adapter.getUpcomingEvents(Sport.GOLF);
      const openEnded = await harness.adapter.getUpcomingEvents(Sport.GOLF, { from: new Date(-8.64e15), to: new Date('2026-07-31T00:00:00Z') });

      expect(all.map((event) => event.externalId)).toEqual(['40', '41', '42', '44']);
      expect(openEnded.map((event) => event.externalId)).toEqual(['44']);
      expect(requestLine(harness.api)).toEqual([
        '/pga/v2/tournaments?include_format=true&per_page=100',
        '/pga/v2/tournaments?include_format=true&per_page=100',
      ]);
    });

    it('answers no events, and calls nothing, for a sport it does not cover', async () => {
      const harness = setup();
      restore = harness.restore;

      expect(await harness.adapter.getUpcomingEvents(Sport.TENNIS)).toEqual([]);
      expect(harness.api.requests).toEqual([]);
    });
  });

  describe('getEventDetails', () => {
    it('loads the tournament, its PLAYER field and each golfer\'s world ranking', async () => {
      const harness = setup();
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('41');

      expect(detail).toMatchObject({ externalId: '41', name: 'BMW Championship', participantCount: 4, rounds: 4, fieldLocked: true });
      expect(detail?.participants.map((participant) => [participant.externalId, participant.name, participant.ranking])).toEqual([
        ['10', 'Michael Brennan', 35],
        ['75', 'Russell Henley', 9],
        ['185', 'Scottie Scheffler', 1],
        ['3', 'Rory McIlroy', 2],
      ]);
      expect(requestLine(harness.api)).toEqual([
        '/pga/v2/tournaments?tournament_ids%5B%5D=41&include_format=true',
        '/pga/v2/tournament_competitors?tournament_id=41&competitor_types%5B%5D=PLAYER&per_page=100',
        '/pga/v1/players?player_ids%5B%5D=10&player_ids%5B%5D=75&player_ids%5B%5D=185&player_ids%5B%5D=3&per_page=100',
      ]);
    });

    it('still loads the whole field when a golfer comes back with no world ranking field at all', async () => {
      const unranked = players.map((player) => (player.id === 75 ? Object.fromEntries(Object.entries(player).filter(([name]) => name !== 'owgr')) : player));
      const harness = setup({ ...defaultRoutes, '/pga/v1/players': pagedRoute(unranked as typeof players) });
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('41');

      expect(detail?.participants.map((participant) => [participant.externalId, participant.ranking])).toEqual([
        ['10', 35], ['75', undefined], ['185', 1], ['3', 2],
      ]);
    });

    it('reads rankings a hundred ids at a time for a large field', async () => {
      const bigField = Array.from({ length: 150 }, (_, index) => ({
        ...competitors[0],
        id: 10_000 + index,
        player: { ...competitors[0].player, id: 2_000 + index },
      }));
      const harness = setup({ ...defaultRoutes, '/pga/v2/tournament_competitors': pagedRoute(bigField) });
      restore = harness.restore;

      const detail = await harness.adapter.getEventDetails('41');

      expect(detail?.participants).toHaveLength(150);
      const rankingReads = harness.api.requests.filter((request) => request.path === '/pga/v1/players');
      expect(rankingReads.map((request) => request.query.getAll('player_ids[]').length)).toEqual([100, 50]);
      expect(harness.api.requests.filter((request) => request.path === '/pga/v2/tournament_competitors')).toHaveLength(2);
    });

    it('answers null for an id the vendor does not have', async () => {
      const harness = setup();
      restore = harness.restore;

      expect(await harness.adapter.getEventDetails('999')).toBeNull();
    });

    it('answers null without calling the vendor for an id that cannot be a tournament id', async () => {
      const harness = setup();
      restore = harness.restore;

      expect(await harness.adapter.getEventDetails('golf-masters-2026')).toBeNull();
      expect(await harness.adapter.getEventDetails('0')).toBeNull();
      expect(harness.api.requests).toEqual([]);
    });
  });

  describe('getParticipants', () => {
    it('lists every active PGA TOUR golfer', async () => {
      const harness = setup();
      restore = harness.restore;

      const golfers = await harness.adapter.getParticipants(Sport.GOLF);

      expect(golfers.map((golfer) => golfer.externalId).sort()).toEqual(['10', '185', '3', '75']);
      expect(requestLine(harness.api)).toEqual(['/pga/v1/players?active=true&per_page=100']);
    });

    it('answers no participants for a sport it does not cover', async () => {
      const harness = setup();
      restore = harness.restore;
      expect(await harness.adapter.getParticipants(Sport.TENNIS)).toEqual([]);
    });
  });

  describe('getLiveScores', () => {
    it('returns every started round of a live stroke-play tournament in the GOLF category', async () => {
      const harness = setup();
      restore = harness.restore;

      const scores = await harness.adapter.getLiveScores('41');

      expect(scores.category).toBe('GOLF');
      expect(scores.externalEventId).toBe('41');
      expect(golfRoundsOf(scores)).toContainEqual({ participantExternalId: '185', round: 3, strokes: 67, scoreToPar: -3, status: ParticipantRoundStatus.IN_PROGRESS, thru: 12 });
      expect(golfRoundsOf(scores)).toContainEqual({ participantExternalId: '10', round: 2, strokes: 73, scoreToPar: 3, status: ParticipantRoundStatus.MISSED_CUT });
      expect(requestLine(harness.api)).toEqual([
        '/pga/v2/tournaments?tournament_ids%5B%5D=41&include_format=true',
        '/pga/v2/tournament_results?tournament_id=41&per_page=100',
      ]);
    });

    it('fails, rather than answering nothing, for a tournament the vendor does not have', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getLiveScores('999')).rejects.toThrow('BALLDONTLIE has no PGA TOUR tournament 999.');
      await expect(harness.adapter.getLiveScores('not-a-number')).rejects.toThrow('BALLDONTLIE has no PGA TOUR tournament not-a-number.');
    });

    it('refuses a team-format tournament without reading its results', async () => {
      const harness = setup();
      restore = harness.restore;

      await expect(harness.adapter.getLiveScores('44')).rejects.toBeInstanceOf(UnsupportedPgaFormatError);
      expect(harness.api.requests.map((request) => request.path)).toEqual(['/pga/v2/tournaments']);
    });

    it('fails the sync with a contract error when the vendor\'s results stop matching what the adapter reads', async () => {
      const harness = setup({
        ...defaultRoutes,
        // Fits the vendor document (thru is a free string) but is not a value the adapter knows.
        '/pga/v2/tournament_results': () => ({ body: { data: [{ ...liveResults[0], thru: 'TEE 10:40' }], meta: { per_page: 100 } } }),
      });
      restore = harness.restore;

      await expect(harness.adapter.getLiveScores('41')).rejects.toBeInstanceOf(BalldontlieContractError);
    });
  });

  describe('healthCheck', () => {
    it('is HEALTHY when a one-row free-tier read succeeds', async () => {
      const harness = setup();
      restore = harness.restore;

      const health = await harness.adapter.healthCheck();

      expect(health).toMatchObject({ providerId: 'balldontlie', status: 'HEALTHY', errorRateLastHour: 0 });
      expect(health.lastSuccessfulPoll).toBeInstanceOf(Date);
      expect(requestLine(harness.api)).toEqual(['/pga/v2/tournaments?per_page=1&include_format=true']);
    });

    it('is DOWN with the vendor\'s reason when the key is refused', async () => {
      const api = createFakeBalldontlie({ league: 'pga', apiKey: 'the-real-key', routes: defaultRoutes });
      const originalFetch = global.fetch;
      global.fetch = api.fetch;
      restore = () => { global.fetch = originalFetch; };
      const adapter = new BalldontlieAdapter({ baseUrl: 'https://api.balldontlie.io', apiKey: 'a-wrong-key', requestsPerMinute: 600 });

      const health = await adapter.healthCheck();

      expect(health).toMatchObject({ status: 'DOWN', errorRateLastHour: 1, message: 'BALLDONTLIE request /pga/v2/tournaments?per_page=1&include_format=true failed: 401 Unauthorized' });
    });
  });

  describe('payload capture', () => {
    it('keeps the raw responses of reads made inside a capture session for the sync run, and none outside', async () => {
      const harness = setup();
      restore = harness.restore;

      await harness.adapter.getLiveScores('41');
      harness.adapter.clearProviderPayloads();
      expect(harness.adapter.consumeProviderPayloads()).toEqual([]);

      const session = harness.adapter.beginProviderPayloadCapture();
      await session.run(() => harness.adapter.getLiveScores('41'));

      expect(session.consumeProviderPayloads().map((capture) => [capture.operation, capture.path])).toEqual([
        ['balldontlie.request', '/pga/v2/tournaments?tournament_ids%5B%5D=41&include_format=true'],
        ['balldontlie.request', '/pga/v2/tournament_results?tournament_id=41&per_page=100'],
      ]);
    });
  });
});

describe('the spec-checking fake BALLDONTLIE', () => {
  const call = async (url: string, init?: RequestInit) => {
    const api = createFakeBalldontlie({ league: 'pga', apiKey: API_KEY, routes: defaultRoutes });
    return api.fetch(`https://api.balldontlie.io${url}`, { headers: { Authorization: API_KEY }, ...init });
  };

  it('rejects a path the vendor document does not declare', async () => {
    await expect(call('/pga/v3/tournaments')).rejects.toThrow(BalldontlieSpecViolation);
  });

  it('rejects an undeclared query parameter, a repeated scalar one and a value outside its schema', async () => {
    await expect(call('/pga/v2/tournaments?tour=pga')).rejects.toThrow('does not declare');
    await expect(call('/pga/v2/tournaments?season=2025&season=2026')).rejects.toThrow('sent "season" 2 times');
    await expect(call('/pga/v2/tournaments?per_page=500')).rejects.toThrow('per_page=500');
    await expect(call('/pga/v2/tournaments?include_format=yes')).rejects.toThrow('include_format=yes');
  });

  it('rejects a request missing a required parameter, and a write', async () => {
    await expect(call('/pga/v2/tournament_results')).rejects.toThrow('left out required query parameter "tournament_id"');
    await expect(call('/pga/v2/tournaments', { method: 'POST' })).rejects.toThrow('the adapter only reads');
  });

  it('rejects a served reply that does not fit the document', async () => {
    const api = createFakeBalldontlie({
      league: 'pga',
      apiKey: API_KEY,
      routes: { '/pga/v2/tournaments': () => ({ body: { data: [{ id: 'forty' }] } }) },
    });
    await expect(api.fetch('https://api.balldontlie.io/pga/v2/tournaments', { headers: { Authorization: API_KEY } }))
      .rejects.toThrow('does not fit the vendor document');
  });

  it('drops format_type from tournaments unless include_format=true is sent, as the vendor documents', async () => {
    const formatTypes = async (url: string) => {
      const page = await (await call(url)).json() as { data: Array<Record<string, unknown>> };
      return page.data.map((row) => row['format_type']);
    };

    expect((await formatTypes('/pga/v2/tournaments?per_page=2')).every((value) => value === undefined)).toBe(true);
    expect((await formatTypes('/pga/v2/tournaments?per_page=2&include_format=false')).every((value) => value === undefined)).toBe(true);
    expect(await formatTypes('/pga/v2/tournaments?per_page=2&include_format=true')).toEqual(['STROKE_PLAY', 'STROKE_PLAY']);
  });

  it('answers 404 for a declared path no route serves, and passes a raw body through', async () => {
    expect((await call('/pga/v1/courses')).status).toBe(404);
    const api = createFakeBalldontlie({
      league: 'pga',
      apiKey: API_KEY,
      routes: { '/pga/v1/courses': () => ({ status: 503, rawBody: 'down' }) },
    });
    const response = await api.fetch(new URL('https://api.balldontlie.io/pga/v1/courses'), { headers: { Authorization: API_KEY } });
    expect([response.status, await response.text()]).toEqual([503, 'down']);
  });
});
