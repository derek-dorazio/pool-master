import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { Sport } from '../../../../packages/shared/domain';
import { BalldontlieAdapter } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { ProviderLeagueRefusedError } from '../../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { ProviderRateLimitedError } from '../../../../packages/core-api/src/modules/ingestion/core/provider-call-policy';
import { createFakeBalldontlie, pagedRoute, type FakeBalldontlie, type FakeRoute } from '../../../support/balldontlie-fake-api';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';
import { fakeLogger } from '../../../support/fake-logger';

/**
 * Each league of a sport is read on its own (#1797): a league the plan refuses, or whose read
 * fails, is left out of its sport's events and teams and logged, and its neighbours still list.
 * On BALLDONTLIE's free plan college football answers 401, which used to fail the NFL's list too.
 * Football (the NFL and college football) is the sport under test, against the same fake
 * BALLDONTLIE the per-league tests use, which checks every request and reply against the
 * vendor's documents.
 */

const API_KEY = 'test-api-key';
const NOW = Date.UTC(2026, 10, 10);
const YEAR_2026 = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') };

const refused: FakeRoute = () => ({ status: 401, body: { error: 'Unauthorized' } });
const failing: FakeRoute = () => ({ status: 400, body: { error: 'Bad request' } });
/** A 429 asking for a minute, longer than one call waits, so the call ends rate limited at once. */
const rateLimited: FakeRoute = () => ({ status: 429, body: { error: 'Too many requests' }, headers: { 'retry-after': '60' } });

const nflRoutes: Record<string, FakeRoute> = {
  '/nfl/v1/games': pagedRoute(z.object({ data: z.array(z.looseObject({ id: z.number() })) }).parse(readBalldontlieFixture('nfl', 'games-2026-week-12.json')).data),
  '/nfl/v1/standings': () => ({ body: { data: [] } }),
  '/nfl/v1/teams': () => ({ body: readBalldontlieFixture('nfl', 'teams.json') }),
};
const freePlan: Record<string, FakeRoute> = { ...nflRoutes, '/ncaaf/v1/games': refused, '/ncaaf/v1/teams': refused };

function setup(routes: Record<string, FakeRoute>, logger?: FastifyBaseLogger, league: string[] = ['nfl', 'ncaaf']): { adapter: BalldontlieAdapter; api: FakeBalldontlie; restore: () => void } {
  const api = createFakeBalldontlie({ league, apiKey: API_KEY, routes });
  const originalFetch = global.fetch;
  global.fetch = api.fetch;
  let now = NOW;
  const adapter = new BalldontlieAdapter({
    baseUrl: 'https://api.balldontlie.io',
    apiKey: API_KEY,
    requestsPerMinute: 600,
    now: () => now,
    sleep: (ms) => { now += ms; return Promise.resolve(); },
    ...(logger && { logger }),
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

const pathsRead = (api: FakeBalldontlie) => [...new Set(api.requests.map((request) => request.path))].sort();

describe('BalldontlieAdapter reads each league of a sport on its own', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it('still lists the NFL\'s events when the plan refuses college football, and warns naming the refused league', async () => {
    const logger = fakeLogger();
    const harness = setup(freePlan, logger);
    restore = harness.restore;

    const events = await harness.adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL, YEAR_2026);

    expect(events.map((event) => event.externalId)).toEqual(['nfl-2026-week-12']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'balldontlie.league.unavailable', sport: Sport.AMERICAN_FOOTBALL, league: 'CFP', read: 'events', refused: true, status: 401, path: expect.stringContaining('/ncaaf/v1/games') as unknown }),
      expect.any(String),
    );
  });

  it('still lists the NFL\'s teams when the plan refuses college football\'s, and warns naming the refused league', async () => {
    const logger = fakeLogger();
    const harness = setup(freePlan, logger);
    restore = harness.restore;

    const teams = await harness.adapter.getParticipants(Sport.AMERICAN_FOOTBALL);

    expect(teams.length).toBeGreaterThan(0);
    expect(teams.every((team) => team.externalId.startsWith('nfl-team-'))).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'balldontlie.league.unavailable', league: 'CFP', read: 'participants', refused: true, status: 401 }),
      expect.any(String),
    );
  });

  it('leaves out a league whose read fails for any other reason too, marked as not refused', async () => {
    const logger = fakeLogger();
    const harness = setup({ ...nflRoutes, '/ncaaf/v1/games': failing, '/ncaaf/v1/teams': failing }, logger);
    restore = harness.restore;

    await expect(harness.adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL, YEAR_2026)).resolves.toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ league: 'CFP', refused: false, status: 400 }), expect.any(String));
  });

  it.each(['events', 'participants'] as const)('fails the sport\'s %s as rate limited when one league\'s read is rate limited, rather than syncing a partial list', async (read) => {
    const logger = fakeLogger();
    const harness = setup({ ...nflRoutes, '/ncaaf/v1/games': rateLimited, '/ncaaf/v1/teams': rateLimited }, logger);
    restore = harness.restore;

    const listing = read === 'events'
      ? harness.adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL, YEAR_2026)
      : harness.adapter.getParticipants(Sport.AMERICAN_FOOTBALL);

    await expect(listing).rejects.toBeInstanceOf(ProviderRateLimitedError);
    expect(logger.warn).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'balldontlie.league.unavailable' }), expect.any(String));
  });

  it('fails the sport\'s list as before when every one of its leagues is refused', async () => {
    const harness = setup({ '/nfl/v1/games': refused, '/nfl/v1/teams': refused, '/ncaaf/v1/games': refused, '/ncaaf/v1/teams': refused });
    restore = harness.restore;

    await expect(harness.adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL, YEAR_2026)).rejects.toThrow('/nfl/v1/games');
    await expect(harness.adapter.getParticipants(Sport.AMERICAN_FOOTBALL)).rejects.toThrow('/nfl/v1/teams');
  });

  it('reads only the named tour\'s league when asked for one tour, ignoring case, so the NFL year import never asks for college football', async () => {
    const harness = setup(freePlan);
    restore = harness.restore;

    const events = await harness.adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL, YEAR_2026, { tour: ' nfl ' });

    expect(events.map((event) => event.externalId)).toEqual(['nfl-2026-week-12']);
    expect(pathsRead(harness.api)).toEqual(['/nfl/v1/games']);
  });

  it('throws a league refusal naming the provider, the league and the status when the plan refuses the one tour asked for', async () => {
    const harness = setup(freePlan);
    restore = harness.restore;

    const read = harness.adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL, YEAR_2026, { tour: 'CFP' });

    await expect(read).rejects.toBeInstanceOf(ProviderLeagueRefusedError);
    await expect(read).rejects.toMatchObject({ providerName: 'BALLDONTLIE', league: 'CFP', status: 401 });
  });

  it('throws a league refusal naming the PGA TOUR when the plan refuses golf\'s tournaments, so a refused golf import gets the clear error too', async () => {
    const harness = setup({ '/pga/v2/tournaments': refused }, undefined, ['pga']);
    restore = harness.restore;

    const read = harness.adapter.getUpcomingEvents(Sport.GOLF, YEAR_2026, { tour: 'PGA TOUR' });

    await expect(read).rejects.toBeInstanceOf(ProviderLeagueRefusedError);
    await expect(read).rejects.toMatchObject({ providerName: 'BALLDONTLIE', league: 'PGA TOUR', status: 401 });
  });

  it('passes on any other failure of the one tour asked for unchanged, so an outage still shows as one', async () => {
    const harness = setup({ ...nflRoutes, '/nfl/v1/games': failing });
    restore = harness.restore;

    const read = harness.adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL, YEAR_2026, { tour: 'NFL' });

    await expect(read).rejects.not.toBeInstanceOf(ProviderLeagueRefusedError);
    await expect(read).rejects.toThrow('/nfl/v1/games');
  });

  it('reads every league as a sport\'s list when the tour asked for names none of them', async () => {
    const harness = setup({ ...nflRoutes, '/ncaaf/v1/games': pagedRoute([]), '/ncaaf/v1/teams': () => ({ body: { data: [] } }) });
    restore = harness.restore;

    await harness.adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL, YEAR_2026, { tour: 'XFL' });

    expect(pathsRead(harness.api)).toEqual(['/ncaaf/v1/games', '/nfl/v1/games']);
  });
});
