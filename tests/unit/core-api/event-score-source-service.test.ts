import {
  EventScoreSourceError,
  EventScoreSourceService,
} from '../../../packages/core-api/src/modules/events/event-score-source-service';

function buildProviderEvent(overrides: Record<string, unknown> = {}) {
  return {
    externalId: 'ext-1',
    providerId: 'mock-golf',
    sport: 'GOLF',
    name: 'The Masters',
    startDate: new Date('2027-04-08T00:00:00.000Z'),
    endDate: new Date('2027-04-11T00:00:00.000Z'),
    status: 'SCHEDULED',
    fieldLocked: false,
    metadata: {},
    ...overrides,
  };
}

function buildProvider(overrides: Record<string, unknown> = {}) {
  return {
    providerId: 'mock-golf',
    getUpcomingEvents: jest.fn().mockResolvedValue([buildProviderEvent()]),
    ...overrides,
  };
}

describe('EventScoreSourceService.listCandidateEvents', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('pool-master-753 404s PROVIDER_NOT_FOUND when the providerId has no registered provider', async () => {
    const providerRegistry = { getProviderById: jest.fn().mockReturnValue(null) };
    const prisma = { sportLeague: { findUnique: jest.fn() } };
    const service = new EventScoreSourceService(prisma as any, providerRegistry as any);

    await expect(service.listCandidateEvents('unknown', 'GOLF' as any)).rejects.toMatchObject({
      code: 'PROVIDER_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('pool-master-753 calls provider.getUpcomingEvents with a default now-3d..now+90d window when from/to are omitted', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    const provider = buildProvider();
    const providerRegistry = { getProviderById: jest.fn().mockReturnValue(provider) };
    const prisma = { sportLeague: { findUnique: jest.fn() } };
    const service = new EventScoreSourceService(prisma as any, providerRegistry as any);

    await service.listCandidateEvents('mock-golf', 'GOLF' as any);

    expect(provider.getUpcomingEvents).toHaveBeenCalledWith('GOLF', {
      from: new Date('2026-12-29T00:00:00.000Z'),
      to: new Date('2027-04-01T00:00:00.000Z'),
    });
  });

  it('pool-master-753 passes explicit from/to through unchanged', async () => {
    const provider = buildProvider();
    const providerRegistry = { getProviderById: jest.fn().mockReturnValue(provider) };
    const prisma = { sportLeague: { findUnique: jest.fn() } };
    const service = new EventScoreSourceService(prisma as any, providerRegistry as any);
    const from = new Date('2027-04-05T00:00:00.000Z');
    const to = new Date('2027-04-14T00:00:00.000Z');

    await service.listCandidateEvents('mock-golf', 'GOLF' as any, { from, to });

    expect(provider.getUpcomingEvents).toHaveBeenCalledWith('GOLF', { from, to });
  });

  it('pool-master-753 maps provider rows to the plain catalog shape with no scoring', async () => {
    const provider = buildProvider({
      getUpcomingEvents: jest.fn().mockResolvedValue([
        buildProviderEvent({ externalId: 'ext-1', name: 'The Masters', endDate: undefined }),
      ]),
    });
    const providerRegistry = { getProviderById: jest.fn().mockReturnValue(provider) };
    const prisma = { sportLeague: { findUnique: jest.fn() } };
    const service = new EventScoreSourceService(prisma as any, providerRegistry as any);

    const result = await service.listCandidateEvents('mock-golf', 'GOLF' as any);

    expect(result).toEqual([
      {
        externalId: 'ext-1',
        name: 'The Masters',
        startDate: new Date('2027-04-08T00:00:00.000Z'),
        endDate: null,
        status: 'SCHEDULED',
      },
    ]);
  });

  it('pool-master-753 filters by the sportLeagueId\'s matchKeyword as a plain substring match', async () => {
    const provider = buildProvider({
      getUpcomingEvents: jest.fn().mockResolvedValue([
        buildProviderEvent({ externalId: 'ext-1', name: 'PGA Championship' }),
        buildProviderEvent({ externalId: 'ext-2', name: 'LIV Golf Miami' }),
      ]),
    });
    const providerRegistry = { getProviderById: jest.fn().mockReturnValue(provider) };
    const prisma = {
      sportLeague: { findUnique: jest.fn().mockResolvedValue({ matchKeyword: 'PGA' }) },
    };
    const service = new EventScoreSourceService(prisma as any, providerRegistry as any);

    const result = await service.listCandidateEvents('mock-golf', 'GOLF' as any, { sportLeagueId: 'league-1' });

    expect(prisma.sportLeague.findUnique).toHaveBeenCalledWith({ where: { id: 'league-1' } });
    expect(result.map((event) => event.externalId)).toEqual(['ext-1']);
  });

  it('pool-master-753 applies no filter when the league has no matchKeyword set', async () => {
    const provider = buildProvider({
      getUpcomingEvents: jest.fn().mockResolvedValue([
        buildProviderEvent({ externalId: 'ext-1', name: 'PGA Championship' }),
        buildProviderEvent({ externalId: 'ext-2', name: 'LIV Golf Miami' }),
      ]),
    });
    const providerRegistry = { getProviderById: jest.fn().mockReturnValue(provider) };
    const prisma = {
      sportLeague: { findUnique: jest.fn().mockResolvedValue({ matchKeyword: null }) },
    };
    const service = new EventScoreSourceService(prisma as any, providerRegistry as any);

    const result = await service.listCandidateEvents('mock-golf', 'GOLF' as any, { sportLeagueId: 'league-1' });

    expect(result.map((event) => event.externalId)).toEqual(['ext-1', 'ext-2']);
  });

  it('pool-master-753 filters by a free-text search term independently of the league filter', async () => {
    const provider = buildProvider({
      getUpcomingEvents: jest.fn().mockResolvedValue([
        buildProviderEvent({ externalId: 'ext-1', name: 'The Masters' }),
        buildProviderEvent({ externalId: 'ext-2', name: 'US Open' }),
      ]),
    });
    const providerRegistry = { getProviderById: jest.fn().mockReturnValue(provider) };
    const prisma = { sportLeague: { findUnique: jest.fn() } };
    const service = new EventScoreSourceService(prisma as any, providerRegistry as any);

    const result = await service.listCandidateEvents('mock-golf', 'GOLF' as any, { search: 'masters' });

    expect(result.map((event) => event.externalId)).toEqual(['ext-1']);
  });
});

describe('EventScoreSourceService.getProviderEventDetail', () => {
  it('pool-master-5h3 404s PROVIDER_NOT_FOUND when the providerId has no registered provider', async () => {
    const providerRegistry = { getProviderById: jest.fn().mockReturnValue(null) };
    const service = new EventScoreSourceService({} as any, providerRegistry as any);

    await expect(service.getProviderEventDetail('unknown', 'ext-1')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('pool-master-5h3 404s PROVIDER_EVENT_NOT_FOUND when the provider returns no event detail', async () => {
    const provider = { providerId: 'mock-golf', getEventDetails: jest.fn().mockResolvedValue(null) };
    const providerRegistry = { getProviderById: jest.fn().mockReturnValue(provider) };
    const service = new EventScoreSourceService({} as any, providerRegistry as any);

    await expect(service.getProviderEventDetail('mock-golf', 'missing-ext')).rejects.toMatchObject({
      code: 'PROVIDER_EVENT_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('pool-master-5h3 returns name/venue/dates from the provider event detail', async () => {
    const provider = {
      providerId: 'mock-golf',
      getEventDetails: jest.fn().mockResolvedValue({
        name: 'The Masters',
        venue: 'Augusta National',
        startDate: new Date('2027-04-08T00:00:00.000Z'),
        endDate: new Date('2027-04-11T00:00:00.000Z'),
        participants: [],
      }),
    };
    const providerRegistry = { getProviderById: jest.fn().mockReturnValue(provider) };
    const service = new EventScoreSourceService({} as any, providerRegistry as any);

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
    const provider = {
      providerId: 'mock-golf',
      getEventDetails: jest.fn().mockResolvedValue({
        name: 'The Masters',
        startDate: new Date('2027-04-08T00:00:00.000Z'),
        participants: [],
      }),
    };
    const providerRegistry = { getProviderById: jest.fn().mockReturnValue(provider) };
    const service = new EventScoreSourceService({} as any, providerRegistry as any);

    const result = await service.getProviderEventDetail('mock-golf', 'ext-1');

    expect(result.venue).toBeNull();
    expect(result.endDate).toBeNull();
  });
});

describe('EventScoreSourceService.linkScoreSource', () => {
  it('pool-master-753 404s EVENT_NOT_FOUND when the sport event does not exist', async () => {
    const prisma = { sportEvent: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new EventScoreSourceService(prisma as any);

    await expect(
      service.linkScoreSource('missing', { providerId: 'mock-golf', externalId: 'ext-1' }),
    ).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });

  it('pool-master-753 409s EVENT_NOT_ADMIN_MANAGED when the event is already provider-owned (syncScope=FULL)', async () => {
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue({ id: 'event-1', syncScope: 'FULL' }),
      },
    };
    const service = new EventScoreSourceService(prisma as any);

    await expect(
      service.linkScoreSource('event-1', { providerId: 'mock-golf', externalId: 'ext-1' }),
    ).rejects.toMatchObject({ code: 'EVENT_NOT_ADMIN_MANAGED', statusCode: 409 });
  });

  it('pool-master-753 409s EXTERNAL_EVENT_ALREADY_LINKED when another sport event already holds that identity', async () => {
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue({ id: 'event-1', syncScope: 'NONE' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'event-2' }),
        update: jest.fn(),
      },
    };
    const service = new EventScoreSourceService(prisma as any);

    await expect(
      service.linkScoreSource('event-1', { providerId: 'mock-golf', externalId: 'ext-1' }),
    ).rejects.toMatchObject({ code: 'EXTERNAL_EVENT_ALREADY_LINKED', statusCode: 409 });
    expect(prisma.sportEvent.findFirst).toHaveBeenCalledWith({
      where: { providerId: 'mock-golf', externalId: 'ext-1', NOT: { id: 'event-1' } },
    });
    expect(prisma.sportEvent.update).not.toHaveBeenCalled();
  });

  it('pool-master-753 sets providerId/externalId/syncScope=SCORES_ONLY when no conflict exists', async () => {
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue({ id: 'event-1', syncScope: 'NONE' }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new EventScoreSourceService(prisma as any);

    await service.linkScoreSource('event-1', { providerId: 'mock-golf', externalId: 'ext-1' });

    expect(prisma.sportEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { providerId: 'mock-golf', externalId: 'ext-1', syncScope: 'SCORES_ONLY' },
    });
  });
});

describe('EventScoreSourceService.unlinkScoreSource', () => {
  it('pool-master-753 404s EVENT_NOT_FOUND when the sport event does not exist', async () => {
    const prisma = { sportEvent: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new EventScoreSourceService(prisma as any);

    await expect(service.unlinkScoreSource('missing')).rejects.toMatchObject({
      code: 'EVENT_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('pool-master-753 409s EVENT_NOT_ADMIN_MANAGED when the event is provider-owned (syncScope=FULL)', async () => {
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue({ id: 'event-1', syncScope: 'FULL' }),
      },
    };
    const service = new EventScoreSourceService(prisma as any);

    await expect(service.unlinkScoreSource('event-1')).rejects.toMatchObject({
      code: 'EVENT_NOT_ADMIN_MANAGED',
      statusCode: 409,
    });
  });

  it('pool-master-753 reverts to the manual-admin placeholder identity and syncScope=NONE', async () => {
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue({ id: 'event-1', syncScope: 'SCORES_ONLY' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new EventScoreSourceService(prisma as any);

    await service.unlinkScoreSource('event-1');

    expect(prisma.sportEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: {
        providerId: 'manual-admin',
        externalId: expect.stringMatching(/^manual-/),
        syncScope: 'NONE',
      },
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
