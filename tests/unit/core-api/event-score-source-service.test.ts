import { expect } from '@jest/globals';
import {
  EventScoreSourceError,
  EventScoreSourceService,
} from '../../../packages/core-api/src/modules/events/event-score-source-service';
import type { SportDataProvider } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
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

    expect(provider.getUpcomingEvents).toHaveBeenCalledWith('GOLF', undefined);
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

    expect(provider.getUpcomingEvents).toHaveBeenCalledWith('GOLF', { from, to });
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

  it('pool-master-753 filters by the sportLeagueId\'s matchKeyword as a plain substring match', async () => {
    const provider = buildProvider({
      getUpcomingEvents: jest.fn().mockResolvedValue([
        buildProviderEvent({ externalId: 'ext-1', name: 'PGA Championship' }),
        buildProviderEvent({ externalId: 'ext-2', name: 'LIV Golf Miami' }),
      ]),
    });
    const providerRegistry = registryWith(provider);
    const prisma = {
      sportLeague: { findUnique: jest.fn().mockResolvedValue({ matchKeyword: 'PGA' }) },
    };
    const service = new EventScoreSourceService(asPrismaClient(prisma), providerRegistry);

    const result = await service.listCandidateEvents('mock-golf', Sport.GOLF, { sportLeagueId: 'league-1' });

    expect(result.map((event) => event.externalId)).toEqual(['ext-1']);
  });

  it('keeps an event whose provider tour name equals the matchKeyword, ignoring case, even when its name lacks the keyword, and still excludes the other tour', async () => {
    const provider = buildProvider({
      getUpcomingEvents: jest.fn().mockResolvedValue([
        buildProviderEvent({ externalId: 'pga-1', name: 'Masters Tournament', metadata: { tour: 'PGA TOUR' } }),
        buildProviderEvent({ externalId: 'lpga-1', name: 'Honda LPGA Thailand', metadata: { tour: 'LPGA Tour' } }),
      ]),
    });
    const prisma = {
      sportLeague: { findUnique: jest.fn().mockResolvedValue({ matchKeyword: 'pga tour' }) },
    };
    const service = new EventScoreSourceService(asPrismaClient(prisma), registryWith(provider));

    const result = await service.listCandidateEvents('mock-golf', Sport.GOLF, { sportLeagueId: 'league-1' });

    expect(result.map((event) => event.externalId)).toEqual(['pga-1']);
  });

  it('pool-master-753 applies no filter when the league has no matchKeyword set', async () => {
    const provider = buildProvider({
      getUpcomingEvents: jest.fn().mockResolvedValue([
        buildProviderEvent({ externalId: 'ext-1', name: 'PGA Championship' }),
        buildProviderEvent({ externalId: 'ext-2', name: 'LIV Golf Miami' }),
      ]),
    });
    const providerRegistry = registryWith(provider);
    const prisma = {
      sportLeague: { findUnique: jest.fn().mockResolvedValue({ matchKeyword: null }) },
    };
    const service = new EventScoreSourceService(asPrismaClient(prisma), providerRegistry);

    const result = await service.listCandidateEvents('mock-golf', Sport.GOLF, { sportLeagueId: 'league-1' });

    expect(result.map((event) => event.externalId)).toEqual(['ext-1', 'ext-2']);
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

// #385: a tour's provider slate for one year, matched by the provider's tour name.
describe('EventScoreSourceService.listTourEventsForYear', () => {
  const pgaLeague = { id: 'pga', name: 'PGA TOUR', matchKeyword: 'PGA TOUR', sport: { name: 'GOLF' } };

  it('returns only events whose provider tour equals the league\'s match keyword, ignoring case, so "PGA TOUR" does not pick up the LPGA', async () => {
    const provider = buildProvider({
      getUpcomingEvents: jest.fn().mockResolvedValue([
        buildProviderEvent({ externalId: 'pga-1', name: 'Alpha Open', venue: 'A Links', metadata: { tour: 'pga tour' } }),
        buildProviderEvent({ externalId: 'lpga-1', name: 'LPGA Alpha', metadata: { tour: 'LPGA Tour' } }),
        buildProviderEvent({ externalId: 'none-1', name: 'PGA TOUR Exhibition', metadata: {} }),
      ]),
    });
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(pgaLeague) } };
    const service = new EventScoreSourceService(asPrismaClient(prisma), registryWith(provider));

    const events = await service.listTourEventsForYear('mock-golf', 'pga', 2027);

    expect(events).toEqual([{
      externalId: 'pga-1',
      name: 'Alpha Open',
      venue: 'A Links',
      startDate: new Date('2027-04-08T00:00:00.000Z'),
      endDate: new Date('2027-04-11T00:00:00.000Z'),
    }]);
  });

  it('asks the provider for the league\'s sport across that calendar year in UTC', async () => {
    const provider = buildProvider();
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(pgaLeague) } };
    const service = new EventScoreSourceService(asPrismaClient(prisma), registryWith(provider));

    await service.listTourEventsForYear('mock-golf', 'pga', 2027);

    expect(provider.getUpcomingEvents).toHaveBeenCalledWith('GOLF', {
      from: new Date('2027-01-01T00:00:00.000Z'),
      to: new Date('2027-12-31T23:59:59.999Z'),
    });
  });

  it('refuses a league with no match keyword with 422 SPORT_LEAGUE_HAS_NO_MATCH_KEYWORD and never calls the provider', async () => {
    const provider = buildProvider();
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue({ ...pgaLeague, matchKeyword: null }) } };
    const service = new EventScoreSourceService(asPrismaClient(prisma), registryWith(provider));

    await expect(service.listTourEventsForYear('mock-golf', 'pga', 2027))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_HAS_NO_MATCH_KEYWORD', statusCode: 422 });
    expect(provider.getUpcomingEvents).not.toHaveBeenCalled();
  });

  it('404s SPORT_LEAGUE_NOT_FOUND for an unknown league and PROVIDER_NOT_FOUND for an unknown provider', async () => {
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(null) } };

    await expect(new EventScoreSourceService(asPrismaClient(prisma), registryWith(buildProvider())).listTourEventsForYear('mock-golf', 'nope', 2027))
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

describe('EventScoreSourceService.startLiveSimulation', () => {
  const linkedEvent = { id: 'event-1', sport: 'GOLF', providerId: 'mock-golf', externalId: 'ext-1', syncScope: 'SCORES_ONLY' };
  const simulationStatus = {
    startsAt: new Date('2026-10-06T12:00:00.000Z'),
    endsAt: new Date('2026-10-06T13:20:00.000Z'),
    minutesPerRound: 20,
    phase: 'IN_PROGRESS' as const,
    currentRound: 1,
  };

  function prismaWith(event: Record<string, unknown> | null) {
    return asPrismaClient({ sportEvent: { findUnique: jest.fn().mockResolvedValue(event) } });
  }

  it('starts the linked provider event\'s simulation and returns its status', async () => {
    const startLiveSimulation = jest.fn().mockResolvedValue(simulationStatus);
    const provider = Object.assign(buildProvider(), { startLiveSimulation, getLiveSimulation: jest.fn() });
    const service = new EventScoreSourceService(prismaWith(linkedEvent), registryWith(provider));

    await expect(service.startLiveSimulation('event-1', { minutesPerRound: 20 })).resolves.toEqual(simulationStatus);
    expect(startLiveSimulation).toHaveBeenCalledWith('ext-1', { minutesPerRound: 20 });
  });

  it('refuses an unlinked event with 409 EVENT_NOT_LINKED and never calls a provider', async () => {
    const startLiveSimulation = jest.fn();
    const provider = Object.assign(buildProvider(), { startLiveSimulation, getLiveSimulation: jest.fn() });
    const service = new EventScoreSourceService(
      prismaWith({ ...linkedEvent, providerId: 'manual-admin', syncScope: 'NONE' }),
      registryWith(provider),
    );

    await expect(service.startLiveSimulation('event-1', {})).rejects.toMatchObject({ code: 'EVENT_NOT_LINKED', statusCode: 409 });
    expect(startLiveSimulation).not.toHaveBeenCalled();
  });

  it('refuses a provider that cannot simulate with 422 LIVE_SIMULATION_UNSUPPORTED', async () => {
    const service = new EventScoreSourceService(prismaWith(linkedEvent), registryWith(buildProvider()));

    await expect(service.startLiveSimulation('event-1', {})).rejects.toMatchObject({
      code: 'LIVE_SIMULATION_UNSUPPORTED',
      statusCode: 422,
    });
  });

  it('refuses a non-golf event linked to a simulating provider with 422 LIVE_SIMULATION_UNSUPPORTED and never calls it', async () => {
    const startLiveSimulation = jest.fn();
    const provider = Object.assign(buildProvider(), { startLiveSimulation, getLiveSimulation: jest.fn() });
    const service = new EventScoreSourceService(prismaWith({ ...linkedEvent, sport: 'TENNIS' }), registryWith(provider));

    await expect(service.startLiveSimulation('event-1', {})).rejects.toMatchObject({
      code: 'LIVE_SIMULATION_UNSUPPORTED',
      statusCode: 422,
    });
    expect(startLiveSimulation).not.toHaveBeenCalled();
  });

  it('404s PROVIDER_EVENT_NOT_FOUND when the provider no longer has the linked event', async () => {
    const provider = Object.assign(buildProvider(), { startLiveSimulation: jest.fn().mockResolvedValue(null), getLiveSimulation: jest.fn() });
    const service = new EventScoreSourceService(prismaWith(linkedEvent), registryWith(provider));

    await expect(service.startLiveSimulation('event-1', {})).rejects.toMatchObject({
      code: 'PROVIDER_EVENT_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('404s EVENT_NOT_FOUND when the sport event does not exist', async () => {
    const service = new EventScoreSourceService(prismaWith(null), registryWith(buildProvider()));

    await expect(service.startLiveSimulation('missing', {})).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

describe('EventScoreSourceService.getLiveSimulation', () => {
  const linkedEvent = { id: 'event-1', sport: 'GOLF', providerId: 'mock-golf', externalId: 'ext-1', syncScope: 'SCORES_ONLY' };

  function serviceWith(getLiveSimulation: jest.Mock) {
    const provider = Object.assign(buildProvider(), { startLiveSimulation: jest.fn(), getLiveSimulation });
    return new EventScoreSourceService(
      asPrismaClient({ sportEvent: { findUnique: jest.fn().mockResolvedValue(linkedEvent) } }),
      registryWith(provider),
    );
  }

  it('returns the running simulation for the linked provider event, with its current round', async () => {
    const status = {
      startsAt: new Date('2026-10-06T12:00:00.000Z'),
      endsAt: new Date('2026-10-06T13:20:00.000Z'),
      minutesPerRound: 20,
      phase: 'IN_PROGRESS' as const,
      currentRound: 3,
    };
    const getLiveSimulation = jest.fn().mockResolvedValue(status);

    await expect(serviceWith(getLiveSimulation).getLiveSimulation('event-1')).resolves.toEqual(status);
    expect(getLiveSimulation).toHaveBeenCalledWith('ext-1');
  });

  it('404s LIVE_SIMULATION_NOT_RUNNING when the provider has no simulation running', async () => {
    await expect(serviceWith(jest.fn().mockResolvedValue(null)).getLiveSimulation('event-1')).rejects.toMatchObject({
      code: 'LIVE_SIMULATION_NOT_RUNNING',
      statusCode: 404,
    });
  });
});

describe('EventScoreSourceError', () => {
  it('pool-master-753 carries message/code/statusCode', () => {
    const error = new EventScoreSourceError('boom', 'SOME_CODE', 422);
    expect(error.message).toBe('boom');
    expect(error.code).toBe('SOME_CODE');
    expect(error.statusCode).toBe(422);
    expect(error.name).toBe('EventScoreSourceError');
  });
});
