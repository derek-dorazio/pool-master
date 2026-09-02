/**
 * Unit tests for GolfFieldService (pool-master-6jk/5h3 / plans/124 §4.2/§4.7/§4.4a/§5.2).
 *
 * Coverage:
 *   - seedFieldFromLeagueRoster: 409 TOURNAMENT_HAS_NO_SEASON when the event
 *     has no season; filters the roster to ACTIVE participants; skips
 *     already-in-field participants (idempotent); derives seedNumber/
 *     oddsToWin only for participants actually being added.
 *   - bulkAddFieldEntries: cross-league invite path, idempotent skip of
 *     already-present participantIds, no derivation.
 *   - bulkUpdateFieldEntries: 404 FIELD_ENTRY_NOT_FOUND for an entry not on
 *     this event; writes SportEventParticipantGolfValuation.price with
 *     priceAssignedSource=MANUAL when price is present.
 *   - removeFieldEntry: 404 when missing/wrong-event, 409
 *     FIELD_ENTRY_HAS_PICKS when a ContestEntryPick references it.
 *   - listField: projects isLeagueRosterMember from the current league roster.
 *   - seedFieldFromProvider (pool-master-5h3): 404 when no provider is
 *     registered or the provider returns no event detail; resolves/creates
 *     Participant+mapping by exact provider identity; the ranking/odds
 *     priority chain (both present, ranking-only, odds-only, neither with/
 *     without league-affiliation fallback); seedNumber always comes from
 *     position assignment, never the provider's own `seed` field; upsert is
 *     idempotent across repeat calls.
 */
import { GolfFieldService } from '../../../packages/core-api/src/modules/golf/golf-field-service';
import * as GolfSeedingAlgorithm from '../../../packages/core-api/src/modules/golf/golf-seeding-algorithm';

function buildFieldRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sep-1',
    participantId: 'p-1',
    isActive: true,
    inactiveReason: null,
    worldRanking: 5,
    oddsToWin: 12.5,
    seedNumber: 3,
    participant: { name: 'Rory McIlroy', shortName: 'R. McIlroy', nationality: 'NIR' },
    golfValuation: null,
    ...overrides,
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  return {
    prisma: {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ seasonId: 'season-1' }),
      },
      season: {
        findUnique: jest.fn().mockResolvedValue({ sportLeagueId: 'league-1' }),
      },
      sportEventParticipant: {
        findMany: jest.fn().mockResolvedValue([buildFieldRow()]),
        findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', sportEventId: 'event-1' }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      contestEntryPick: {
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    },
    sportLeagueService: {
      getRoster: jest.fn().mockResolvedValue([
        { participantId: 'p-1', name: 'Rory McIlroy', shortName: 'R. McIlroy', nationality: 'NIR', status: 'ACTIVE', worldRanking: 5 },
      ]),
    },
    random: () => 0.5,
    ...overrides,
  };
}

describe('GolfFieldService.listField', () => {
  it('pool-master-6jk projects isLeagueRosterMember from the tournament\'s current league roster', async () => {
    const deps = buildDeps();
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    const result = await service.listField('event-1');

    expect(result).toEqual([
      expect.objectContaining({
        sportEventParticipantId: 'sep-1',
        participantId: 'p-1',
        participantName: 'Rory McIlroy',
        isLeagueRosterMember: true,
      }),
    ]);
  });

  it('pool-master-6jk sets isLeagueRosterMember false for a golfer not on the league roster', async () => {
    const deps = buildDeps({
      sportLeagueService: { getRoster: jest.fn().mockResolvedValue([]) },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    const result = await service.listField('event-1');

    expect(result[0].isLeagueRosterMember).toBe(false);
  });

  it('pool-master-6jk treats a null season as no roster at all, without querying it', async () => {
    const deps = buildDeps({
      prisma: {
        sportEvent: { findUniqueOrThrow: jest.fn().mockResolvedValue({ seasonId: null }) },
        sportEventParticipant: { findMany: jest.fn().mockResolvedValue([buildFieldRow()]) },
        season: { findUnique: jest.fn() },
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    const result = await service.listField('event-1');

    expect(deps.prisma.season.findUnique).not.toHaveBeenCalled();
    expect(result[0].isLeagueRosterMember).toBe(false);
  });
});

describe('GolfFieldService.seedFieldFromLeagueRoster', () => {
  it('pool-master-6jk rejects with 409 TOURNAMENT_HAS_NO_SEASON when the event has no season', async () => {
    const deps = buildDeps({
      prisma: { sportEvent: { findUniqueOrThrow: jest.fn().mockResolvedValue({ seasonId: null }) } },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    await expect(service.seedFieldFromLeagueRoster('event-1')).rejects.toMatchObject({
      name: 'GolfFieldError',
      code: 'TOURNAMENT_HAS_NO_SEASON',
      statusCode: 409,
    });
  });

  it('pool-master-6jk filters the roster to ACTIVE participants, skips existing field members, and derives seed/odds only for the added ones', async () => {
    const deps = buildDeps({
      sportLeagueService: {
        getRoster: jest.fn().mockResolvedValue([
          { participantId: 'p-existing', name: 'Existing Golfer', shortName: null, nationality: null, status: 'ACTIVE', worldRanking: 1 },
          { participantId: 'p-new', name: 'New Golfer', shortName: null, nationality: null, status: 'ACTIVE', worldRanking: 2 },
          { participantId: 'p-inactive', name: 'Inactive Golfer', shortName: null, nationality: null, status: 'INACTIVE', worldRanking: 3 },
        ]),
      },
      prisma: {
        sportEvent: { findUniqueOrThrow: jest.fn().mockResolvedValue({ seasonId: 'season-1' }) },
        season: { findUnique: jest.fn().mockResolvedValue({ sportLeagueId: 'league-1' }) },
        sportEventParticipant: {
          findMany: jest.fn().mockResolvedValue([{ participantId: 'p-existing' }]),
          create: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    const result = await service.seedFieldFromLeagueRoster('event-1');

    expect(deps.prisma.sportEventParticipant.create).toHaveBeenCalledTimes(1);
    expect(deps.prisma.sportEventParticipant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sportEventId: 'event-1', participantId: 'p-new', seedNumber: 1 }),
    });
    expect(result).toEqual({
      added: 1,
      skipped: 1,
      total: 2,
      seedNumbersDerived: 1,
      oddsDerived: 1,
    });
  });

  it('pool-master-6jk is a full no-op (no create call) when every active roster member is already in the field', async () => {
    const deps = buildDeps({
      prisma: {
        sportEvent: { findUniqueOrThrow: jest.fn().mockResolvedValue({ seasonId: 'season-1' }) },
        season: { findUnique: jest.fn().mockResolvedValue({ sportLeagueId: 'league-1' }) },
        sportEventParticipant: {
          findMany: jest.fn().mockResolvedValue([{ participantId: 'p-1' }]),
          create: jest.fn(),
        },
        $transaction: jest.fn(),
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    const result = await service.seedFieldFromLeagueRoster('event-1');

    expect(deps.prisma.$transaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ added: 0, skipped: 1, total: 1 });
  });
});

describe('GolfFieldService.bulkAddFieldEntries', () => {
  it('pool-master-6jk adds participants with no derivation and skips ones already in the field', async () => {
    const deps = buildDeps({
      prisma: {
        sportEventParticipant: {
          findMany: jest.fn().mockResolvedValue([{ participantId: 'p-existing' }]),
          create: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    const result = await service.bulkAddFieldEntries('event-1', ['p-existing', 'p-new']);

    expect(deps.prisma.sportEventParticipant.create).toHaveBeenCalledTimes(1);
    expect(deps.prisma.sportEventParticipant.create).toHaveBeenCalledWith({
      data: { sportEventId: 'event-1', participantId: 'p-new' },
    });
    expect(result).toEqual({ added: 1, skipped: 1, total: 2 });
  });
});

describe('GolfFieldService.bulkUpdateFieldEntries', () => {
  it('pool-master-6jk writes field columns and upserts the golf valuation price with priceAssignedSource=MANUAL', async () => {
    const deps = buildDeps({
      prisma: {
        sportEvent: { findUniqueOrThrow: jest.fn().mockResolvedValue({ seasonId: null }) },
        sportEventParticipant: {
          findMany: jest.fn()
            .mockResolvedValueOnce([{ id: 'sep-1' }])
            .mockResolvedValueOnce([buildFieldRow()]),
          update: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    await service.bulkUpdateFieldEntries('event-1', [
      { sportEventParticipantId: 'sep-1', isActive: false, inactiveReason: 'WITHDRAWN', price: 19.5 },
    ]);

    expect(deps.prisma.sportEventParticipant.update).toHaveBeenCalledWith({
      where: { id: 'sep-1' },
      data: {
        isActive: false,
        inactiveReason: 'WITHDRAWN',
        golfValuation: {
          upsert: {
            create: { price: 19.5, priceAssignedSource: 'MANUAL' },
            update: { price: 19.5, priceAssignedSource: 'MANUAL' },
          },
        },
      },
    });
  });

  it('pool-master-6jk rejects with 404 FIELD_ENTRY_NOT_FOUND for an entry not on this event, before writing anything', async () => {
    const deps = buildDeps({
      prisma: {
        sportEventParticipant: {
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn(),
        },
        $transaction: jest.fn(),
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    await expect(
      service.bulkUpdateFieldEntries('event-1', [{ sportEventParticipantId: 'sep-missing', isActive: true }]),
    ).rejects.toMatchObject({ name: 'GolfFieldError', code: 'FIELD_ENTRY_NOT_FOUND', statusCode: 404 });
    expect(deps.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('GolfFieldService.removeFieldEntry', () => {
  it('pool-master-6jk deletes a field entry with no picks referencing it', async () => {
    const deps = buildDeps();
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    await service.removeFieldEntry('event-1', 'sep-1');

    expect(deps.prisma.sportEventParticipant.delete).toHaveBeenCalledWith({ where: { id: 'sep-1' } });
  });

  it('pool-master-6jk rejects with 409 FIELD_ENTRY_HAS_PICKS when a ContestEntryPick references it', async () => {
    const deps = buildDeps({
      prisma: {
        sportEventParticipant: {
          findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', sportEventId: 'event-1' }),
          delete: jest.fn(),
        },
        contestEntryPick: { count: jest.fn().mockResolvedValue(2) },
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    await expect(service.removeFieldEntry('event-1', 'sep-1')).rejects.toMatchObject({
      code: 'FIELD_ENTRY_HAS_PICKS',
      statusCode: 409,
    });
    expect(deps.prisma.sportEventParticipant.delete).not.toHaveBeenCalled();
  });

  it('pool-master-6jk rejects with 404 when the entry belongs to a different sport event', async () => {
    const deps = buildDeps({
      prisma: {
        sportEventParticipant: {
          findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', sportEventId: 'other-event' }),
          delete: jest.fn(),
        },
        contestEntryPick: { count: jest.fn() },
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    await expect(service.removeFieldEntry('event-1', 'sep-1')).rejects.toMatchObject({
      code: 'FIELD_ENTRY_NOT_FOUND',
      statusCode: 404,
    });
  });
});

describe('GolfFieldService.seedFieldFromProvider', () => {
  function buildProviderParticipant(overrides: Record<string, unknown> = {}) {
    return {
      externalId: 'ext-1',
      providerId: 'mock-golf',
      sport: 'GOLF',
      name: 'Rory McIlroy',
      active: true,
      metadata: {},
      ...overrides,
    };
  }

  function buildProviderFieldDeps(overrides: Record<string, unknown> = {}) {
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          providerId: 'mock-golf',
          externalId: 'event-ext-1',
          seasonId: 'season-1',
        }),
      },
      season: {
        findUnique: jest.fn().mockResolvedValue({ sportLeagueId: 'league-1' }),
      },
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      sport: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sport-golf' }),
      },
      participant: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: `participant-${data.externalId}`, ...data })),
      },
      sportEventParticipant: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation((arg) => (
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg)
      )),
      ...(overrides.prisma as object ?? {}),
    };
    const provider = {
      providerId: 'mock-golf',
      getEventDetails: jest.fn().mockResolvedValue({ participants: [buildProviderParticipant()] }),
      ...(overrides.provider as object ?? {}),
    };
    const providerRegistry = {
      getProviderById: jest.fn().mockReturnValue(provider),
      ...(overrides.providerRegistry as object ?? {}),
    };
    const sportLeagueService = {
      getRoster: jest.fn().mockResolvedValue([]),
      ...(overrides.sportLeagueService as object ?? {}),
    };
    return { prisma, provider, providerRegistry, sportLeagueService, random: () => 0.5 };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('pool-master-5h3 404s PROVIDER_NOT_FOUND when the tournament\'s providerId has no registered provider', async () => {
    const deps = buildProviderFieldDeps({ providerRegistry: { getProviderById: jest.fn().mockReturnValue(null) } });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random, deps.providerRegistry as any);

    await expect(service.seedFieldFromProvider('event-1')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('pool-master-5h3 404s PROVIDER_EVENT_NOT_FOUND when the provider returns no event detail', async () => {
    const deps = buildProviderFieldDeps({ provider: { getEventDetails: jest.fn().mockResolvedValue(null) } });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random, deps.providerRegistry as any);

    await expect(service.seedFieldFromProvider('event-1')).rejects.toMatchObject({
      code: 'PROVIDER_EVENT_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('pool-master-5h3 creates a new Participant + ParticipantProviderMapping when no mapping exists yet', async () => {
    const deps = buildProviderFieldDeps();
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random, deps.providerRegistry as any);

    await service.seedFieldFromProvider('event-1');

    expect(deps.prisma.participant.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sportId: 'sport-golf', name: 'Rory McIlroy', externalId: 'ext-1' }),
    }));
    expect(deps.prisma.participantProviderMapping.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ providerId: 'mock-golf', externalId: 'ext-1', confidence: 'EXACT' }),
    }));
  });

  it('pool-master-5h3 reuses the existing Participant when a mapping already exists, without creating a new one', async () => {
    const deps = buildProviderFieldDeps({
      prisma: {
        participantProviderMapping: {
          findUnique: jest.fn().mockResolvedValue({ participantId: 'existing-participant-1' }),
          create: jest.fn(),
        },
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random, deps.providerRegistry as any);

    await service.seedFieldFromProvider('event-1');

    expect(deps.prisma.participant.create).not.toHaveBeenCalled();
    expect(deps.prisma.participantProviderMapping.create).not.toHaveBeenCalled();
    expect(deps.prisma.sportEventParticipant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sportEventId_participantId: { sportEventId: 'event-1', participantId: 'existing-participant-1' } },
    }));
  });

  it('pool-master-5h3 uses ranking and odds as-is (no derivation) when both are present, but still derives seedNumber from position', async () => {
    const deps = buildProviderFieldDeps({
      provider: {
        getEventDetails: jest.fn().mockResolvedValue({
          participants: [buildProviderParticipant({ metadata: { ranking: 3, odds: 25, seed: 99 } })],
        }),
      },
    });
    jest.spyOn(GolfSeedingAlgorithm, 'deriveSeedNumbersAndOdds').mockReturnValue([
      { participantId: 'existing-participant-1', worldRanking: 3, seedNumber: 7, oddsToWin: 999 },
    ]);
    deps.prisma.participantProviderMapping.findUnique = jest.fn().mockResolvedValue({ participantId: 'existing-participant-1' });

    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random, deps.providerRegistry as any);
    await service.seedFieldFromProvider('event-1');

    expect(GolfSeedingAlgorithm.deriveSeedNumbersAndOdds).toHaveBeenCalledWith(
      [{ participantId: 'existing-participant-1', worldRanking: 3 }],
      deps.random,
    );
    expect(deps.prisma.sportEventParticipant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        worldRanking: 3,
        oddsToWin: 25, // provider's own odds, not the mocked-derived 999
        seedNumber: 7, // seedNumber always comes from position assignment
      }),
    }));
  });

  it('pool-master-5h3 derives oddsToWin from ranking-based position when only ranking is present', async () => {
    const deps = buildProviderFieldDeps({
      provider: {
        getEventDetails: jest.fn().mockResolvedValue({
          participants: [buildProviderParticipant({ metadata: { ranking: 5 } })],
        }),
      },
    });
    jest.spyOn(GolfSeedingAlgorithm, 'deriveSeedNumbersAndOdds').mockReturnValue([
      { participantId: 'participant-ext-1', worldRanking: 5, seedNumber: 1, oddsToWin: 12.5 },
    ]);

    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random, deps.providerRegistry as any);
    await service.seedFieldFromProvider('event-1');

    expect(deps.prisma.sportEventParticipant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ worldRanking: 5, oddsToWin: 12.5, seedNumber: 1 }),
    }));
  });

  it('pool-master-5h3 derives an implied position from odds ascending when only odds is present, never touching the ranking pool', async () => {
    const deps = buildProviderFieldDeps({
      provider: {
        getEventDetails: jest.fn().mockResolvedValue({
          participants: [
            buildProviderParticipant({ externalId: 'ext-longshot', name: 'Long Shot', metadata: { odds: 100 } }),
            buildProviderParticipant({ externalId: 'ext-favorite', name: 'Favorite', metadata: { odds: 5 } }),
          ],
        }),
      },
    });
    const deriveSpy = jest.spyOn(GolfSeedingAlgorithm, 'deriveSeedNumbersAndOdds').mockReturnValue([]);

    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random, deps.providerRegistry as any);
    await service.seedFieldFromProvider('event-1');

    // Neither odds-only candidate has a ranking signal, so the ranking pool call is empty.
    expect(deriveSpy).toHaveBeenCalledWith([], deps.random);

    const upsertCalls = deps.prisma.sportEventParticipant.upsert.mock.calls;
    const favoriteCall = upsertCalls.find((call: any) => call[0].where.sportEventId_participantId.participantId === 'participant-ext-favorite');
    const longshotCall = upsertCalls.find((call: any) => call[0].where.sportEventId_participantId.participantId === 'participant-ext-longshot');

    expect(favoriteCall[0].create).toEqual(expect.objectContaining({ worldRanking: null, oddsToWin: 5, seedNumber: 1 }));
    expect(longshotCall[0].create).toEqual(expect.objectContaining({ worldRanking: null, oddsToWin: 100, seedNumber: 2 }));
  });

  it('pool-master-5h3 falls back to league-affiliation worldRanking when the provider supplies neither ranking nor odds', async () => {
    const deps = buildProviderFieldDeps({
      provider: {
        getEventDetails: jest.fn().mockResolvedValue({
          participants: [buildProviderParticipant()],
        }),
      },
      sportLeagueService: {
        getRoster: jest.fn().mockResolvedValue([
          { participantId: 'participant-ext-1', worldRanking: 42 },
        ]),
      },
    });
    const deriveSpy = jest.spyOn(GolfSeedingAlgorithm, 'deriveSeedNumbersAndOdds').mockReturnValue([
      { participantId: 'participant-ext-1', worldRanking: 42, seedNumber: 1, oddsToWin: 8 },
    ]);

    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random, deps.providerRegistry as any);
    await service.seedFieldFromProvider('event-1');

    expect(deriveSpy).toHaveBeenCalledWith([{ participantId: 'participant-ext-1', worldRanking: 42 }], deps.random);
  });

  it('pool-master-5h3 joins the ranking pool with a null worldRanking when neither the provider nor league affiliation has a signal', async () => {
    const deps = buildProviderFieldDeps({
      provider: {
        getEventDetails: jest.fn().mockResolvedValue({
          participants: [buildProviderParticipant()],
        }),
      },
    });
    const deriveSpy = jest.spyOn(GolfSeedingAlgorithm, 'deriveSeedNumbersAndOdds').mockReturnValue([
      { participantId: 'participant-ext-1', worldRanking: null, seedNumber: 1, oddsToWin: 8 },
    ]);

    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random, deps.providerRegistry as any);
    await service.seedFieldFromProvider('event-1');

    expect(deriveSpy).toHaveBeenCalledWith([{ participantId: 'participant-ext-1', worldRanking: null }], deps.random);
  });

  it('pool-master-5h3 is an upsert, not create-only: running it again for an existing field participant updates rather than duplicates, and added=0', async () => {
    const deps = buildProviderFieldDeps({
      prisma: {
        participantProviderMapping: {
          findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-ext-1' }),
          create: jest.fn(),
        },
        sportEventParticipant: {
          findMany: jest.fn().mockResolvedValue([{ participantId: 'participant-ext-1' }]),
          upsert: jest.fn().mockResolvedValue({}),
        },
      },
    });
    jest.spyOn(GolfSeedingAlgorithm, 'deriveSeedNumbersAndOdds').mockReturnValue([
      { participantId: 'participant-ext-1', worldRanking: null, seedNumber: 1, oddsToWin: 8 },
    ]);

    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random, deps.providerRegistry as any);
    const result = await service.seedFieldFromProvider('event-1');

    expect(result).toEqual(expect.objectContaining({ added: 0, total: 1 }));
  });
});
