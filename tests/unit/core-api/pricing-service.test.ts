import { PricingAndTierService } from '../../../packages/core-api/src/modules/participants/pricing-service';

describe('PricingAndTierService', () => {
  it('prices budget contests from odds metadata when odds pricing is requested', async () => {
    const pool = makePool();
    const poolParticipants = [
      makePoolParticipant('pp-1', 'p1', { ranking: 1 }),
      makePoolParticipant('pp-2', 'p2', { ranking: 2 }),
    ];

    const poolRepo = {
      findByContest: jest.fn().mockResolvedValue(pool),
    };
    const poolParticipantRepo = {
      findByPool: jest.fn().mockResolvedValue(poolParticipants),
      update: jest.fn().mockImplementation(async (id, updates) => ({ id, ...updates })),
    };
    const seasonRecordRepo = {
      findByParticipantAndSeason: jest
        .fn()
        .mockResolvedValueOnce(makeSeasonRecord('p1', { rank: 1, formRating: 60 }))
        .mockResolvedValueOnce(makeSeasonRecord('p2', { rank: 2, formRating: 60 })),
    };
    const participantRepo = {
      findById: jest
        .fn()
        .mockResolvedValueOnce(makeParticipant('p1', { odds: 4 }))
        .mockResolvedValueOnce(makeParticipant('p2', { odds: 12 })),
    };

    const service = new PricingAndTierService(
      poolRepo as any,
      poolParticipantRepo as any,
      seasonRecordRepo as any,
      participantRepo as any,
    );

    const result = await service.calculateAndApplyPrices('contest-1', {
      contestId: 'contest-1',
      sport: 'GOLF',
      totalBudget: 5000000,
      minPrice: 500000,
      maxPrice: 1200000,
      priceIncrement: 1000,
      rankingWeight: 0.15,
      formWeight: 0.1,
      oddsWeight: 0.75,
      seedWeight: 0,
      manualOverrides: [],
    });

    expect(result.updated).toBe(2);
    expect(poolParticipantRepo.update).toHaveBeenCalledTimes(2);

    const prices = poolParticipantRepo.update.mock.calls.map(([, updates]) => updates.cost);
    expect(prices[0]).toBeGreaterThan(prices[1]);
  });

  it('assigns tiers from seed metadata with ranking fallback available', async () => {
    const pool = makePool();
    const poolParticipants = [
      makePoolParticipant('pp-1', 'p1', { ranking: 3 }),
      makePoolParticipant('pp-2', 'p2', { ranking: 1 }),
      makePoolParticipant('pp-3', 'p3', { ranking: 2 }),
    ];

    const poolRepo = {
      findByContest: jest.fn().mockResolvedValue(pool),
    };
    const poolParticipantRepo = {
      findByPool: jest.fn().mockResolvedValue(poolParticipants),
      update: jest.fn().mockImplementation(async (id, updates) => ({ id, ...updates })),
    };
    const seasonRecordRepo = {
      findByParticipantAndSeason: jest
        .fn()
        .mockResolvedValueOnce(makeSeasonRecord('p1', { rank: 3, budgetPrice: 300000 }))
        .mockResolvedValueOnce(makeSeasonRecord('p2', { rank: 1, budgetPrice: 500000 }))
        .mockResolvedValueOnce(makeSeasonRecord('p3', { rank: 2, budgetPrice: 400000 })),
    };
    const participantRepo = {
      findById: jest
        .fn()
        .mockResolvedValueOnce(makeParticipant('p1', { seed: 3 }))
        .mockResolvedValueOnce(makeParticipant('p2', { seed: 1 }))
        .mockResolvedValueOnce(makeParticipant('p3', { seed: 2 })),
    };

    const service = new PricingAndTierService(
      poolRepo as any,
      poolParticipantRepo as any,
      seasonRecordRepo as any,
      participantRepo as any,
    );

    const result = await service.assignAndApplyTiers('contest-1', {
      contestId: 'contest-1',
      sport: 'NCAA_BASKETBALL',
      assignmentMode: 'AUTO_SEED',
      tiers: [
        {
          tierId: 'tier-1',
          tierName: 'Tier 1',
          tierNumber: 1,
          picksFromTier: 1,
          participantIds: [],
          maxParticipants: 1,
        },
        {
          tierId: 'tier-2',
          tierName: 'Tier 2',
          tierNumber: 2,
          picksFromTier: 1,
          participantIds: [],
          maxParticipants: 2,
        },
      ],
    });

    expect(result.assigned).toBe(3);
    expect(poolParticipantRepo.update).toHaveBeenCalledWith('pp-2', { tier: 'tier-1' });
  });

  it('assigns tiers from odds metadata when odds mode is selected', async () => {
    const pool = makePool();
    const poolParticipants = [
      makePoolParticipant('pp-1', 'p1'),
      makePoolParticipant('pp-2', 'p2'),
      makePoolParticipant('pp-3', 'p3'),
    ];

    const poolRepo = {
      findByContest: jest.fn().mockResolvedValue(pool),
    };
    const poolParticipantRepo = {
      findByPool: jest.fn().mockResolvedValue(poolParticipants),
      update: jest.fn().mockImplementation(async (id, updates) => ({ id, ...updates })),
    };
    const seasonRecordRepo = {
      findByParticipantAndSeason: jest
        .fn()
        .mockResolvedValueOnce(makeSeasonRecord('p1'))
        .mockResolvedValueOnce(makeSeasonRecord('p2'))
        .mockResolvedValueOnce(makeSeasonRecord('p3')),
    };
    const participantRepo = {
      findById: jest
        .fn()
        .mockResolvedValueOnce(makeParticipant('p1', { odds: 3 }))
        .mockResolvedValueOnce(makeParticipant('p2', { odds: 6 }))
        .mockResolvedValueOnce(makeParticipant('p3', { odds: 12 })),
    };

    const service = new PricingAndTierService(
      poolRepo as any,
      poolParticipantRepo as any,
      seasonRecordRepo as any,
      participantRepo as any,
    );

    const result = await service.assignAndApplyTiers('contest-1', {
      contestId: 'contest-1',
      sport: 'GOLF',
      assignmentMode: 'AUTO_ODDS',
      tiers: [
        {
          tierId: 'tier-1',
          tierName: 'Tier 1',
          tierNumber: 1,
          picksFromTier: 1,
          participantIds: [],
          maxParticipants: 1,
        },
        {
          tierId: 'tier-2',
          tierName: 'Tier 2',
          tierNumber: 2,
          picksFromTier: 2,
          participantIds: [],
          maxParticipants: 2,
        },
      ],
    });

    expect(result.assigned).toBe(3);
    expect(poolParticipantRepo.update).toHaveBeenCalledWith('pp-1', { tier: 'tier-1' });
  });

  it('falls back to odds-based ordering when rankings are missing for pricing', async () => {
    const pool = makePool();
    const poolParticipants = [
      makePoolParticipant('pp-1', 'p1'),
      makePoolParticipant('pp-2', 'p2'),
    ];

    const poolRepo = {
      findByContest: jest.fn().mockResolvedValue(pool),
    };
    const poolParticipantRepo = {
      findByPool: jest.fn().mockResolvedValue(poolParticipants),
      update: jest.fn().mockImplementation(async (id, updates) => ({ id, ...updates })),
    };
    const seasonRecordRepo = {
      findByParticipantAndSeason: jest
        .fn()
        .mockResolvedValueOnce(makeSeasonRecord('p1', { formRating: 50 }))
        .mockResolvedValueOnce(makeSeasonRecord('p2', { formRating: 50 })),
    };
    const participantRepo = {
      findById: jest
        .fn()
        .mockResolvedValueOnce(makeParticipant('p1', { odds: 4 }))
        .mockResolvedValueOnce(makeParticipant('p2', { odds: 10 })),
    };

    const service = new PricingAndTierService(
      poolRepo as any,
      poolParticipantRepo as any,
      seasonRecordRepo as any,
      participantRepo as any,
    );

    await service.calculateAndApplyPrices('contest-1', {
      contestId: 'contest-1',
      sport: 'GOLF',
      totalBudget: 5000000,
      minPrice: 500000,
      maxPrice: 1200000,
      priceIncrement: 1000,
      rankingWeight: 0.75,
      formWeight: 0,
      oddsWeight: 0.25,
      seedWeight: 0,
      manualOverrides: [],
    });

    const prices = poolParticipantRepo.update.mock.calls.map(([, updates]) => updates.cost);
    expect(prices[0]).toBeGreaterThan(prices[1]);
  });
});

function makePool() {
  return {
    id: 'pool-1',
    contestId: 'contest-1',
    sport: 'GOLF',
    eventId: 'event-1',
    poolType: 'EVENT_FIELD',
    config: {},
    excludedParticipantIds: [],
    poolLocked: false,
  };
}

function makePoolParticipant(
  id: string,
  participantId: string,
  extras: { ranking?: number; cost?: number } = {},
) {
  return {
    id,
    poolId: 'pool-1',
    contestId: 'contest-1',
    participantId,
    ranking: extras.ranking,
    cost: extras.cost,
    isAvailable: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeSeasonRecord(
  participantId: string,
  extras: { rank?: number; formRating?: number; budgetPrice?: number } = {},
) {
  return {
    id: `season-${participantId}`,
    participantId,
    sport: 'GOLF',
    season: '2025-2026',
    rankings: extras.rank ? [{ rank: extras.rank, rankingType: 'WORLD_RANKING', asOfDate: new Date() }] : [],
    budgetPrice: extras.budgetPrice ?? 0,
    eventsEntered: 0,
    eventsCompleted: 0,
    wins: 0,
    top5Finishes: 0,
    top10Finishes: 0,
    top25Finishes: 0,
    seasonStats: {},
    formRating: extras.formRating ?? 50,
    formTrend: 'STABLE',
    lastUpdated: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeParticipant(id: string, metadata: Record<string, unknown>) {
  return {
    id,
    sportId: 'sport-1',
    name: id,
    participantType: 'TEAM',
    metadata,
    status: 'ACTIVE',
    injuryStatus: { status: 'HEALTHY' },
    externalIds: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
