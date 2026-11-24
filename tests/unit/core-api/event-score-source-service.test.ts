import { expect } from '@jest/globals';
import {
  EventScoreSourceError,
  EventScoreSourceService,
} from '../../../packages/core-api/src/modules/events/event-score-source-service';
import { ProviderLeagueRefusedError, type SportDataProvider } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { Sport } from '@poolmaster/shared/domain';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { asPrismaClient } from '../../support/prisma-double';

function buildProviderEvent(overrides: Record<string, unknown> = {}) {
  return {
    externalId: 'ext-1',
    providerId: 'mock-golf',
    sport: 'GOLF',
    name: 'The Masters',
    startDate: new Date('2027-04-08T00:00:00.000Z'),
    endDate: new Date('2027-04-11T00:00:00.000Z'),
    status: 'SCHEDULED',
    metadata: {},
    ...overrides,
  };
}

function buildProvider(overrides: Partial<SportDataProvider> = {}): SportDataProvider {
  return fakeSportDataProvider({
    providerId: 'mock-golf',
    getUpcomingEvents: jest.fn().mockResolvedValue([buildProviderEvent()]),
    ...overrides,
  });
}

/** BALLDONTLIE's id: a league's selected mapping names its provider by its row (#1997). */
const SYNCED_PROVIDER = 'balldontlie';

/** A sport league row read with its selected provider mapping, as the service reads it; null code: not synced. */
/** A sport league's provider mappings as the browse reads them, each to a BALLDONTLIE league. */
function mappingRows(...providerLeagueCodes: string[]) {
  return providerLeagueCodes.map((code) => ({ providerLeague: { code, provider: { code: 'BALLDONTLIE' } } }));
}

function leagueRow(providerLeagueCode: string | null, extra: Record<string, unknown> = {}) {
  return {
    id: 'league-1', name: 'PGA TOUR', sport: { sport: 'GOLF' }, ...extra,
    selectedProviderMapping: providerLeagueCode === null ? null : {
      id: 'mapping-1',
      providerLeague: { id: 'provider-league-1', code: providerLeagueCode, name: providerLeagueCode.toUpperCase(), provider: { code: 'BALLDONTLIE', name: 'BALLDONTLIE' } },
    },
  };
}

describe('EventScoreSourceService.listCandidateEvents', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('pool-master-753 404s PROVIDER_NOT_FOUND when the providerId has no registered provider', async () => {
    const providerRegistry = registryWith(null);
    const prisma = { sportLeague: { findUnique: jest.fn() } };
    const service = new EventScoreSourceService(asPrismaClient(prisma), providerRegistry);

    await expect(service.listCandidateEvents('unknown', Sport.GOLF)).rejects.toMatchObject({
      code: 'PROVIDER_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('asks the provider for every event, with no window around today, when from and to are omitted', async () => {
    const provider = buildProvider();
    const providerRegistry = registryWith(provider);
    const prisma = { sportLeague: { findUnique: jest.fn() } };
    const service = new EventScoreSourceService(asPrismaClient(prisma), providerRegistry);

    await service.listCandidateEvents('mock-golf', Sport.GOLF);

    expect(provider.getUpcomingEvents).toHaveBeenCalledWith('GOLF', undefined, undefined);
  });

  it('leaves the other end of the window open when only one of from or to is given', async () => {
    const provider = buildProvider();
    const providerRegistry = registryWith(provider);
    const prisma = { sportLeague: { findUnique: jest.fn() } };
    const service = new EventScoreSourceService(asPrismaClient(prisma), providerRegistry);
    const from = new Date('2027-04-05T00:00:00.000Z');

    await service.listCandidateEvents('mock-golf', Sport.GOLF, { from });

    const [, range] = (provider.getUpcomingEvents as jest.Mock).mock.calls[0] as [string, { from: Date; to: Date }];
    expect(range.from).toEqual(from);
    expect(range.to.getTime()).toBeGreaterThan(new Date('9999-01-01T00:00:00.000Z').getTime());
  });

  it('pool-master-753 passes explicit from/to through unchanged', async () => {
    const provider = buildProvider();
    const providerRegistry = registryWith(provider);
    const prisma = { sportLeague: { findUnique: jest.fn() } };
    const service = new EventScoreSourceService(asPrismaClient(prisma), providerRegistry);
    const from = new Date('2027-04-05T00:00:00.000Z');
    const to = new Date('2027-04-14T00:00:00.000Z');

    await service.listCandidateEvents('mock-golf', Sport.GOLF, { from, to });

    expect(provider.getUpcomingEvents).toHaveBeenCalledWith('GOLF', { from, to }, undefined);
  });

  it('pool-master-753 returns the provider events themselves, unscored and unreshaped', async () => {
    const event = buildProviderEvent({ externalId: 'ext-1', name: 'The Masters', endDate: undefined });
    const provider = buildProvider({
      getUpcomingEvents: jest.fn().mockResolvedValue([event]),
    });
    const providerRegistry = registryWith(provider);
    const prisma = { sportLeague: { findUnique: jest.fn() } };
    const service = new EventScoreSourceService(asPrismaClient(prisma), providerRegistry);

    const result = await service.listCandidateEvents('mock-golf', Sport.GOLF);

    // #205 — the browse returns provider events; the DTO mapper owns the wire shape.
    expect(result).toEqual([event]);
  });

  it('narrows the browse to the provider league the sport league is mapped to, by the code each event carries, never by its name', async () => {
    const provider = buildProvider({
      providerId: SYNCED_PROVIDER,
      getUpcomingEvents: jest.fn().mockResolvedValue([
        buildProviderEvent({ externalId: 'nba-2025-postseason', name: 'NBA Playoffs', providerLeagueCode: 'nba' }),
        buildProviderEvent({ externalId: 'wnba-2026-postseason', name: 'WNBA Playoffs', providerLeagueCode: 'wnba' }),
        buildProviderEvent({ externalId: 'nba-exhibition', name: 'NBA Exhibition' }),
      ]),
    });
    const findMany = jest.fn().mockResolvedValue(mappingRows('nba'));
    const service = new EventScoreSourceService(asPrismaClient({ sportLeagueProviderMapping: { findMany } }), registryWith(provider));

    const result = await service.listCandidateEvents(SYNCED_PROVIDER, Sport.BASKETBALL, { sportLeagueId: 'league-1' });

    expect(result.map((event) => event.externalId)).toEqual(['nba-2025-postseason']);
    expect(provider.getUpcomingEvents).toHaveBeenCalledWith(Sport.BASKETBALL, undefined, { providerLeagueCode: 'nba' });
    // Every mapping counts, selected for the league's sync or not: a mapped league that is not
    // synced yet still browses its own provider league, not the whole sport's feed.
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sportLeagueId: 'league-1' } }));
  });

  it('keeps the events of every provider league a sport league is mapped to on this provider, asking the provider for all of them', async () => {
    const provider = buildProvider({
      providerId: SYNCED_PROVIDER,
      getUpcomingEvents: jest.fn().mockResolvedValue([
        buildProviderEvent({ externalId: 'nba-1', providerLeagueCode: 'nba' }),
        buildProviderEvent({ externalId: 'wnba-1', providerLeagueCode: 'wnba' }),
        buildProviderEvent({ externalId: 'ncaab-1', providerLeagueCode: 'ncaab' }),
      ]),
    });
    const findMany = jest.fn().mockResolvedValue(mappingRows('nba', 'wnba'));
    const service = new EventScoreSourceService(asPrismaClient({ sportLeagueProviderMapping: { findMany } }), registryWith(provider));

    const result = await service.listCandidateEvents(SYNCED_PROVIDER, Sport.BASKETBALL, { sportLeagueId: 'league-1' });

    expect(result.map((event) => event.externalId)).toEqual(['nba-1', 'wnba-1']);
    expect(provider.getUpcomingEvents).toHaveBeenCalledWith(Sport.BASKETBALL, undefined, undefined);
  });

  it('applies no league filter when the sport league has no mapping, or is mapped only to another provider', async () => {
    const provider = buildProvider({
      getUpcomingEvents: jest.fn().mockResolvedValue([
        buildProviderEvent({ externalId: 'ext-1', name: 'PGA Championship', providerLeagueCode: 'pga' }),
        buildProviderEvent({ externalId: 'ext-2', name: 'LIV Golf Miami' }),
      ]),
    });
    const findMany = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(mappingRows('pga'));
    const service = new EventScoreSourceService(asPrismaClient({ sportLeagueProviderMapping: { findMany } }), registryWith(provider));

    const unmapped = await service.listCandidateEvents('mock-golf', Sport.GOLF, { sportLeagueId: 'league-1' });
    const otherProvider = await service.listCandidateEvents('mock-golf', Sport.GOLF, { sportLeagueId: 'league-1' });

    expect(unmapped.map((event) => event.externalId)).toEqual(['ext-1', 'ext-2']);
    expect(otherProvider.map((event) => event.externalId)).toEqual(['ext-1', 'ext-2']);
    expect(provider.getUpcomingEvents).toHaveBeenLastCalledWith(Sport.GOLF, undefined, undefined);
  });

  it('pool-master-753 filters by a free-text search term independently of the league filter', async () => {
    const provider = buildProvider({
      getUpcomingEvents: jest.fn().mockResolvedValue([
        buildProviderEvent({ externalId: 'ext-1', name: 'The Masters' }),
        buildProviderEvent({ externalId: 'ext-2', name: 'US Open' }),
      ]),
    });
    const providerRegistry = registryWith(provider);
    const prisma = { sportLeague: { findUnique: jest.fn() } };
    const service = new EventScoreSourceService(asPrismaClient(prisma), providerRegistry);

    const result = await service.listCandidateEvents('mock-golf', Sport.GOLF, { search: 'masters' });

    expect(result.map((event) => event.externalId)).toEqual(['ext-1']);
  });
});

// #385: a league's provider slate for one year, from the provider league its selected mapping names (#1997).
describe('EventScoreSourceService.listTourEventsForYear', () => {
  const pgaLeague = leagueRow('pga');
  const syncedProvider = (overrides: Partial<SportDataProvider> = {}) => buildProvider({ providerId: SYNCED_PROVIDER, ...overrides });

  it('returns only events of the league\'s provider league, by their code, so the PGA TOUR does not pick up the LPGA', async () => {
    const provider = syncedProvider({
      getUpcomingEvents: jest.fn().mockResolvedValue([
        buildProviderEvent({ externalId: 'pga-1', name: 'Alpha Open', venue: 'A Links', providerLeagueCode: 'pga' }),
        buildProviderEvent({ externalId: 'lpga-1', name: 'LPGA Alpha', providerLeagueCode: 'lpga' }),
        buildProviderEvent({ externalId: 'none-1', name: 'PGA TOUR Exhibition' }),
      ]),
    });
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(pgaLeague) } };
    const service = new EventScoreSourceService(asPrismaClient(prisma), registryWith(provider));

    const events = await service.listTourEventsForYear(SYNCED_PROVIDER, 'pga', 2027);

    expect(events).toEqual([{
      externalId: 'pga-1',
      name: 'Alpha Open',
      venue: 'A Links',
      startDate: new Date('2027-04-08T00:00:00.000Z'),
      endDate: new Date('2027-04-11T00:00:00.000Z'),
    }]);
  });

  it('asks the provider for the league\'s sport across that calendar year in UTC, naming its provider league so it reads only that league', async () => {
    const provider = syncedProvider();
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(pgaLeague) } };
    const service = new EventScoreSourceService(asPrismaClient(prisma), registryWith(provider));

    await service.listTourEventsForYear(SYNCED_PROVIDER, 'pga', 2027);

    expect(provider.getUpcomingEvents).toHaveBeenCalledWith('GOLF', {
      from: new Date('2027-01-01T00:00:00.000Z'),
      to: new Date('2027-12-31T23:59:59.999Z'),
    }, { providerLeagueCode: 'pga' });
  });

  it('refuses with 422 PROVIDER_LEAGUE_REFUSED, naming the league, when the provider\'s plan refuses the tour\'s league', async () => {
    const provider = syncedProvider({ getUpcomingEvents: jest.fn().mockRejectedValue(new ProviderLeagueRefusedError('BALLDONTLIE', 'NFL', 401)) });
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(pgaLeague) } };
    const service = new EventScoreSourceService(asPrismaClient(prisma), registryWith(provider));

    await expect(service.listTourEventsForYear(SYNCED_PROVIDER, 'pga', 2027)).rejects.toMatchObject({
      code: 'PROVIDER_LEAGUE_REFUSED',
      statusCode: 422,
      message: expect.stringContaining('BALLDONTLIE refused NFL') as unknown,
    });
  });

  it('passes on any other provider failure unchanged', async () => {
    const outage = new Error('BALLDONTLIE request /nfl/v1/games failed: 503');
    const provider = syncedProvider({ getUpcomingEvents: jest.fn().mockRejectedValue(outage) });
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(pgaLeague) } };
    const service = new EventScoreSourceService(asPrismaClient(prisma), registryWith(provider));

    await expect(service.listTourEventsForYear(SYNCED_PROVIDER, 'pga', 2027)).rejects.toBe(outage);
  });

  it('refuses a league with no selected mapping, or one to another provider, with 422 SPORT_LEAGUE_NOT_SYNCED and never calls the provider', async () => {
    const provider = syncedProvider();
    const otherProvider = buildProvider();
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValueOnce(leagueRow(null)).mockResolvedValueOnce(pgaLeague) } };

    await expect(new EventScoreSourceService(asPrismaClient(prisma), registryWith(provider)).listTourEventsForYear(SYNCED_PROVIDER, 'pga', 2027))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_SYNCED', statusCode: 422 });
    await expect(new EventScoreSourceService(asPrismaClient(prisma), registryWith(otherProvider)).listTourEventsForYear('mock-golf', 'pga', 2027))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_SYNCED', statusCode: 422 });
    expect(provider.getUpcomingEvents).not.toHaveBeenCalled();
    expect(otherProvider.getUpcomingEvents).not.toHaveBeenCalled();
  });

  it('404s SPORT_LEAGUE_NOT_FOUND for an unknown league and PROVIDER_NOT_FOUND for an unknown provider', async () => {
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(null) } };

    await expect(new EventScoreSourceService(asPrismaClient(prisma), registryWith(syncedProvider())).listTourEventsForYear(SYNCED_PROVIDER, 'nope', 2027))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
    await expect(new EventScoreSourceService(asPrismaClient(prisma), registryWith(null)).listTourEventsForYear('unknown', 'pga', 2027))
      .rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND', statusCode: 404 });
  });
});

describe('EventScoreSourceService.getProviderEventDetail', () => {
  it('pool-master-5h3 404s PROVIDER_NOT_FOUND when the providerId has no registered provider', async () => {
    const providerRegistry = registryWith(null);
    const service = new EventScoreSourceService(asPrismaClient({}), providerRegistry);

    await expect(service.getProviderEventDetail('unknown', 'ext-1')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('pool-master-5h3 404s PROVIDER_EVENT_NOT_FOUND when the provider returns no event detail', async () => {
    const provider = buildProvider({ getEventDetails: jest.fn().mockResolvedValue(null) });
    const providerRegistry = registryWith(provider);
    const service = new EventScoreSourceService(asPrismaClient({}), providerRegistry);

    await expect(service.getProviderEventDetail('mock-golf', 'missing-ext')).rejects.toMatchObject({
      code: 'PROVIDER_EVENT_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('pool-master-5h3 returns name/venue/dates from the provider event detail', async () => {
    const provider = buildProvider({
      getEventDetails: jest.fn().mockResolvedValue({
        name: 'The Masters',
        venue: 'Augusta National',
        startDate: new Date('2027-04-08T00:00:00.000Z'),
        endDate: new Date('2027-04-11T00:00:00.000Z'),
        participants: [],
      }),
    });
    const providerRegistry = registryWith(provider);
    const service = new EventScoreSourceService(asPrismaClient({}), providerRegistry);

    const result = await service.getProviderEventDetail('mock-golf', 'ext-1');

    expect(provider.getEventDetails).toHaveBeenCalledWith('ext-1');
    expect(result).toEqual({
      name: 'The Masters',
      venue: 'Augusta National',
      startDate: new Date('2027-04-08T00:00:00.000Z'),
      endDate: new Date('2027-04-11T00:00:00.000Z'),
    });
  });

  it('pool-master-5h3 defaults venue/endDate to null when the provider omits them', async () => {
    const provider = buildProvider({
      getEventDetails: jest.fn().mockResolvedValue({
        name: 'The Masters',
        startDate: new Date('2027-04-08T00:00:00.000Z'),
        participants: [],
      }),
    });
    const providerRegistry = registryWith(provider);
    const service = new EventScoreSourceService(asPrismaClient({}), providerRegistry);

    const result = await service.getProviderEventDetail('mock-golf', 'ext-1');

    expect(result.venue).toBeNull();
    expect(result.endDate).toBeNull();
  });
});

describe('EventScoreSourceError', () => {
  it('pool-master-753 carries message/code/statusCode', () => {
    const error = new EventScoreSourceError('boom', 'PROVIDER_NOT_FOUND', 422);
    expect(error.message).toBe('boom');
    expect(error.code).toBe('PROVIDER_NOT_FOUND');
    expect(error.statusCode).toBe(422);
    expect(error.name).toBe('EventScoreSourceError');
  });
});

describe('EventScoreSourceService linking a score source', () => {
  const golfEvent = { id: 'event-1', sport: 'GOLF', providerId: 'manual-admin', externalId: 'manual-1', syncScope: 'NONE' };

  function linking(options: { conflict?: boolean; provider?: SportDataProvider | null; event?: Record<string, unknown> } = {}) {
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue(options.event ?? golfEvent),
        findFirst: jest.fn().mockResolvedValue(options.conflict ? { id: 'event-2' } : null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new EventScoreSourceService(asPrismaClient(prisma), registryWith(options.provider === undefined ? buildProvider() : options.provider));
    return { service, prisma };
  }

  it('links the event to the provider\'s event for scores only, in one write', async () => {
    const { service, prisma } = linking();

    await service.linkScoreSource('event-1', { providerId: 'mock-golf', externalId: 'ext-1' });

    expect(prisma.sportEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { providerId: 'mock-golf', externalId: 'ext-1', syncScope: 'SCORES_ONLY' },
    });
  });

  it('refuses an unknown provider (404), a provider not covering the sport (422) and a provider event already linked elsewhere (409), writing nothing', async () => {
    const unknown = linking({ provider: null });
    const otherSport = linking({ event: { ...golfEvent, sport: 'TENNIS' } });
    const taken = linking({ conflict: true });
    const input = { providerId: 'mock-golf', externalId: 'ext-1' };

    await expect(unknown.service.linkScoreSource('event-1', input)).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND', statusCode: 404 });
    await expect(otherSport.service.linkScoreSource('event-1', input)).rejects.toMatchObject({ code: 'PROVIDER_SPORT_MISMATCH', statusCode: 422 });
    await expect(taken.service.linkScoreSource('event-1', input)).rejects.toMatchObject({ code: 'EXTERNAL_EVENT_ALREADY_LINKED', statusCode: 409 });
    for (const { prisma } of [unknown, otherSport, taken]) expect(prisma.sportEvent.update).not.toHaveBeenCalled();
  });

  it('unlinks the event back to a manual placeholder that syncs nothing', async () => {
    const { service, prisma } = linking({ event: { ...golfEvent, providerId: 'mock-golf', syncScope: 'SCORES_ONLY' } });

    await service.unlinkScoreSource('event-1');

    expect(prisma.sportEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { providerId: 'manual-admin', externalId: expect.stringMatching(/^manual-/), syncScope: 'NONE' },
    });
  });
});
