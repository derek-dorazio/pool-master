import { GolfTierSource, GolfValuationSource } from '@poolmaster/shared/domain';
import {
  DEFAULT_TIER_COUNT,
  GolfTierService,
} from '../../../packages/core-api/src/modules/golf/golf-tier-service';
import * as GolfSeedingAlgorithm from '../../../packages/core-api/src/modules/golf/golf-seeding-algorithm';

function buildTierRow(overrides: Record<string, unknown> = {}) {
  return {
    id: `tier-${overrides.tierNumber ?? 1}`,
    sportEventId: 'event-1',
    tierKey: `tier-${overrides.tierNumber ?? 1}`,
    label: `Tier ${overrides.tierNumber ?? 1}`,
    tierNumber: 1,
    defaultPickCount: 1,
    ...overrides,
  };
}

describe('GolfTierService.ensureDefaultGolfTiers', () => {
  it('pool-master-p15 creates DEFAULT_TIER_COUNT tiers when none exist', async () => {
    const create = jest.fn()
      .mockImplementation(({ data }) => Promise.resolve(buildTierRow({ tierNumber: data.tierNumber })));
    const prisma = {
      sportEventGolfTier: {
        findMany: jest.fn().mockResolvedValue([]),
        create,
      },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    const service = new GolfTierService(prisma as any);

    const result = await service.ensureDefaultGolfTiers('event-1');

    expect(create).toHaveBeenCalledTimes(DEFAULT_TIER_COUNT);
    expect(create).toHaveBeenCalledWith({
      data: {
        sportEventId: 'event-1',
        tierKey: 'tier-1',
        label: 'Tier 1',
        tierNumber: 1,
        defaultPickCount: 1,
      },
    });
    expect(result).toHaveLength(DEFAULT_TIER_COUNT);
    expect(result.map((tier) => tier.tierNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('pool-master-p15 is a no-op returning existing tiers when the event already has tiers', async () => {
    const existing = [buildTierRow({ tierNumber: 1 }), buildTierRow({ tierNumber: 2 })];
    const create = jest.fn();
    const prisma = {
      sportEventGolfTier: {
        findMany: jest.fn().mockResolvedValue(existing),
        create,
      },
      $transaction: jest.fn(),
    };
    const service = new GolfTierService(prisma as any);

    const result = await service.ensureDefaultGolfTiers('event-1');

    expect(create).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
  });
});

describe('GolfTierService.getEffectiveTiersForContest', () => {
  it('pool-master-p15 resolves the contest\'s SportEvent then reads its tiers and valuations — no contest-owned path', async () => {
    const prisma = {
      contest: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ sportEventId: 'event-1' }),
      },
      sportEventGolfTier: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...buildTierRow({ tierNumber: 1 }),
            valuations: [
              {
                sportEventParticipantId: 'sep-1',
                tierOrderIndex: 1,
                price: 19.5,
                sportEventParticipant: { participantId: 'participant-1' },
              },
            ],
          },
        ]),
      },
    };
    const service = new GolfTierService(prisma as any);

    const result = await service.getEffectiveTiersForContest('contest-1');

    expect(prisma.contest.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'contest-1' },
      select: { sportEventId: true },
    });
    expect(prisma.sportEventGolfTier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sportEventId: 'event-1' } }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        tierKey: 'tier-1',
        participants: [
          { sportEventParticipantId: 'sep-1', participantId: 'participant-1', tierOrderIndex: 1, price: 19.5 },
        ],
      }),
    ]);
  });

  it('pool-master-p15 returns an empty list when the contest has no linked SportEvent', async () => {
    const prisma = {
      contest: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ sportEventId: null }),
      },
      sportEventGolfTier: { findMany: jest.fn() },
    };
    const service = new GolfTierService(prisma as any);

    const result = await service.getEffectiveTiersForContest('contest-1');

    expect(result).toEqual([]);
    expect(prisma.sportEventGolfTier.findMany).not.toHaveBeenCalled();
  });
});

describe('GolfTierService.autoAssignGolfTiers', () => {
  function buildField(count: number, statsFn: (i: number) => { oddsToWin: number | null; worldRanking: number | null; isActive?: boolean }) {
    return Array.from({ length: count }, (_, i) => ({
      id: `sep-${i + 1}`,
      participantId: `participant-${i + 1}`,
      isActive: true,
      ...statsFn(i),
    }));
  }

  it('pool-master-p15 sorts by ODDS ascending and fills every tier but the last at tierSize', async () => {
    // 25 golfers, 3 tiers, tierSize 10 -> tier1: 10, tier2: 10, tier3: 5 (absorbs remainder)
    const tiers = [
      buildTierRow({ tierNumber: 1 }),
      buildTierRow({ tierNumber: 2 }),
      buildTierRow({ tierNumber: 3 }),
    ];
    const field = buildField(25, (i) => ({ oddsToWin: i + 1, worldRanking: null }));
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      sportEventGolfTier: { findMany: jest.fn().mockResolvedValue(tiers) },
      sportEventParticipant: { findMany: jest.fn().mockResolvedValue(field) },
      sportEventParticipantGolfValuation: { upsert },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    const service = new GolfTierService(prisma as any);
    jest.spyOn(service, 'getEffectiveTiersForSportEvent').mockResolvedValue([]);

    await service.autoAssignGolfTiers({ sportEventId: 'event-1', source: GolfTierSource.ODDS });

    expect(prisma.sportEventParticipant.findMany).toHaveBeenCalledWith({
      where: { sportEventId: 'event-1', isActive: true },
      select: { id: true, participantId: true, oddsToWin: true, worldRanking: true },
    });
    expect(upsert).toHaveBeenCalledTimes(25);
    // Lowest odds (best) sorts first -> participant-1 (odds 1) is order 1, tier 1
    expect(upsert.mock.calls[0][0]).toMatchObject({
      where: { sportEventParticipantId: 'sep-1' },
      create: { sportEventGolfTierId: tiers[0].id, tierOrderIndex: 1, tierAssignedSource: GolfValuationSource.AUTO_ODDS },
    });
    // 21st golfer (0-indexed 20) is the first of the last tier (indexes 20-24 -> tier index 2)
    expect(upsert.mock.calls[20][0]).toMatchObject({
      create: { sportEventGolfTierId: tiers[2].id, tierOrderIndex: 21 },
    });
    // Last golfer also lands in the absorbing last tier, proving it isn't capped at tierSize
    expect(upsert.mock.calls[24][0]).toMatchObject({
      create: { sportEventGolfTierId: tiers[2].id, tierOrderIndex: 25 },
    });
  });

  it('pool-master-p15 sorts by WORLD_RANK ascending, falling back to ODDS on a tie', async () => {
    const tiers = [buildTierRow({ tierNumber: 1 })];
    const field = [
      { id: 'sep-a', participantId: 'p-a', isActive: true, oddsToWin: 5, worldRanking: 10 },
      { id: 'sep-b', participantId: 'p-b', isActive: true, oddsToWin: 2, worldRanking: 10 },
      { id: 'sep-c', participantId: 'p-c', isActive: true, oddsToWin: 1, worldRanking: 3 },
    ];
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      sportEventGolfTier: { findMany: jest.fn().mockResolvedValue(tiers) },
      sportEventParticipant: { findMany: jest.fn().mockResolvedValue(field) },
      sportEventParticipantGolfValuation: { upsert },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    const service = new GolfTierService(prisma as any);
    jest.spyOn(service, 'getEffectiveTiersForSportEvent').mockResolvedValue([]);

    await service.autoAssignGolfTiers({ sportEventId: 'event-1', source: GolfTierSource.WORLD_RANK });

    // p-c (rank 3) first, then tie between p-a/p-b (rank 10) broken by lower odds -> p-b before p-a
    const order = upsert.mock.calls.map(([arg]) => arg.where.sportEventParticipantId);
    expect(order).toEqual(['sep-c', 'sep-b', 'sep-a']);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      create: { tierAssignedSource: GolfValuationSource.AUTO_WORLD_RANK },
    });
  });

  it('pool-master-p15 excludes inactive participants from the field entirely', async () => {
    const tiers = [buildTierRow({ tierNumber: 1 })];
    const prisma = {
      sportEventGolfTier: { findMany: jest.fn().mockResolvedValue(tiers) },
      sportEventParticipant: {
        findMany: jest.fn().mockResolvedValue([{ id: 'sep-1', participantId: 'p-1', oddsToWin: 1, worldRanking: null }]),
      },
      sportEventParticipantGolfValuation: { upsert: jest.fn() },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    const service = new GolfTierService(prisma as any);
    jest.spyOn(service, 'getEffectiveTiersForSportEvent').mockResolvedValue([]);

    await service.autoAssignGolfTiers({ sportEventId: 'event-1', source: GolfTierSource.ODDS });

    expect(prisma.sportEventParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sportEventId: 'event-1', isActive: true } }),
    );
  });

  it('pool-master-p15 returns an empty list and does not query the field when the event has no tiers yet', async () => {
    const findMany = jest.fn();
    const prisma = {
      sportEventGolfTier: { findMany: jest.fn().mockResolvedValue([]) },
      sportEventParticipant: { findMany },
    };
    const service = new GolfTierService(prisma as any, { warn: jest.fn() } as any);

    const result = await service.autoAssignGolfTiers({ sportEventId: 'event-1', source: GolfTierSource.ODDS });

    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('GolfTierService.getEffectiveValuationsForContest / getEffectiveValuationsForSportEvent', () => {
  it('pool-master-piv reads valuations directly, carrying tier + price together for a tiered golfer', async () => {
    const prisma = {
      contest: { findUniqueOrThrow: jest.fn().mockResolvedValue({ sportEventId: 'event-1' }) },
      sportEventParticipantGolfValuation: {
        findMany: jest.fn().mockResolvedValue([
          {
            sportEventParticipantId: 'sep-1',
            tierOrderIndex: 1,
            price: 25,
            sportEventParticipant: { participantId: 'p-1' },
            sportEventGolfTier: { id: 'tier-1', tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1 },
          },
          {
            sportEventParticipantId: 'sep-2',
            tierOrderIndex: 1,
            price: null,
            sportEventParticipant: { participantId: 'p-2' },
            sportEventGolfTier: { id: 'tier-2', tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2 },
          },
        ]),
      },
    };
    const service = new GolfTierService(prisma as any);

    const result = await service.getEffectiveValuationsForContest('contest-1');

    expect(result).toEqual([
      { sportEventParticipantId: 'sep-1', participantId: 'p-1', tierId: 'tier-1', tierKey: 'tier-1', tierLabel: 'Tier 1', tierNumber: 1, tierOrderIndex: 1, price: 25 },
      { sportEventParticipantId: 'sep-2', participantId: 'p-2', tierId: 'tier-2', tierKey: 'tier-2', tierLabel: 'Tier 2', tierNumber: 2, tierOrderIndex: 1, price: null },
    ]);
  });

  it('pool-master-753 includes a price-only valuation with no tier assignment (budget-format contest)', async () => {
    const prisma = {
      sportEventParticipantGolfValuation: {
        findMany: jest.fn().mockResolvedValue([
          {
            sportEventParticipantId: 'sep-3',
            tierOrderIndex: null,
            price: 3200,
            sportEventParticipant: { participantId: 'p-3' },
            sportEventGolfTier: null,
          },
        ]),
      },
    };
    const service = new GolfTierService(prisma as any);

    const result = await service.getEffectiveValuationsForSportEvent('event-1');

    expect(result).toEqual([
      { sportEventParticipantId: 'sep-3', participantId: 'p-3', tierId: null, tierKey: null, tierLabel: null, tierNumber: null, tierOrderIndex: null, price: 3200 },
    ]);
  });
});

describe('GolfTierService.replaceGolfTournamentTiers', () => {
  function buildTx(existing: unknown[]) {
    const update = jest.fn().mockResolvedValue(undefined);
    const upsert = jest.fn().mockResolvedValue(undefined);
    const deleteMany = jest.fn().mockResolvedValue(undefined);
    const updateManyValuations = jest.fn().mockResolvedValue(undefined);
    const findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 'tier-target' });
    const prisma = {
      sportEventGolfTier: {
        findMany: jest.fn().mockResolvedValue(existing),
        update,
        upsert,
        deleteMany,
        findUniqueOrThrow,
      },
      sportEventParticipantGolfValuation: { updateMany: updateManyValuations },
      $transaction: jest.fn().mockImplementation((fn) => fn(prisma)),
    };
    return { prisma, update, upsert, deleteMany, updateManyValuations, findUniqueOrThrow };
  }

  it('pool-master-piv upserts every tier in the new list and never touches removed tiers when nothing was removed', async () => {
    const existing = [{ ...buildTierRow({ tierNumber: 1 }), valuations: [] }];
    const { prisma, upsert, deleteMany } = buildTx(existing);
    const service = new GolfTierService(prisma as any);
    jest.spyOn(service, 'getEffectiveTiersForSportEvent').mockResolvedValue([]);

    await service.replaceGolfTournamentTiers({
      sportEventId: 'event-1',
      tiers: [{ tierKey: 'tier-1', label: 'Tier One', tierNumber: 1, defaultPickCount: 2 }],
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { sportEventId_tierKey: { sportEventId: 'event-1', tierKey: 'tier-1' } },
      create: { sportEventId: 'event-1', tierKey: 'tier-1', label: 'Tier One', tierNumber: 1, defaultPickCount: 2 },
      update: { label: 'Tier One', tierNumber: 1, defaultPickCount: 2 },
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('pool-master-piv rejects removing a tier with assignments when reassignOrphansTo is not supplied', async () => {
    const existing = [{ ...buildTierRow({ tierNumber: 1 }), valuations: [{ id: 'val-1' }] }];
    const { prisma } = buildTx(existing);
    const service = new GolfTierService(prisma as any);

    await expect(
      service.replaceGolfTournamentTiers({ sportEventId: 'event-1', tiers: [{ tierKey: 'tier-2', label: 'New', tierNumber: 1, defaultPickCount: 1 }] }),
    ).rejects.toMatchObject({
      name: 'GolfTierError',
      code: 'TIER_REPLACE_WOULD_ORPHAN_ASSIGNMENTS',
      statusCode: 409,
    });
  });

  it('pool-master-piv rejects a reassignOrphansTo tierKey that is not present in the new tier list', async () => {
    const existing = [{ ...buildTierRow({ tierNumber: 1 }), valuations: [] }];
    const { prisma } = buildTx(existing);
    const service = new GolfTierService(prisma as any);

    await expect(
      service.replaceGolfTournamentTiers({
        sportEventId: 'event-1',
        tiers: [{ tierKey: 'tier-2', label: 'New', tierNumber: 1, defaultPickCount: 1 }],
        reassignOrphansTo: 'tier-not-in-list',
      }),
    ).rejects.toMatchObject({ code: 'REASSIGN_TARGET_TIER_NOT_FOUND', statusCode: 422 });
  });

  it('pool-master-piv reassigns orphaned valuations to the target tier, then deletes the removed tier', async () => {
    const existing = [{ ...buildTierRow({ tierNumber: 1, id: 'tier-old' }), valuations: [{ id: 'val-1' }] }];
    const { prisma, updateManyValuations, deleteMany, findUniqueOrThrow } = buildTx(existing);
    const service = new GolfTierService(prisma as any);
    jest.spyOn(service, 'getEffectiveTiersForSportEvent').mockResolvedValue([]);

    await service.replaceGolfTournamentTiers({
      sportEventId: 'event-1',
      tiers: [{ tierKey: 'tier-2', label: 'Survivor', tierNumber: 1, defaultPickCount: 1 }],
      reassignOrphansTo: 'tier-2',
    });

    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { sportEventId_tierKey: { sportEventId: 'event-1', tierKey: 'tier-2' } },
    });
    expect(updateManyValuations).toHaveBeenCalledWith({
      where: { sportEventGolfTierId: { in: ['tier-old'] } },
      data: { sportEventGolfTierId: 'tier-target', tierOrderIndex: null },
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['tier-old'] } } });
  });

  it('pool-master-piv bumps every existing tier\'s number to a temp negative value before upserting final numbers, avoiding a unique-index collision on a swap', async () => {
    const existing = [
      { ...buildTierRow({ tierNumber: 1, id: 'tier-a', tierKey: 'a' }), valuations: [] },
      { ...buildTierRow({ tierNumber: 2, id: 'tier-b', tierKey: 'b' }), valuations: [] },
    ];
    const { prisma, update } = buildTx(existing);
    const service = new GolfTierService(prisma as any);
    jest.spyOn(service, 'getEffectiveTiersForSportEvent').mockResolvedValue([]);

    await service.replaceGolfTournamentTiers({
      sportEventId: 'event-1',
      tiers: [
        { tierKey: 'a', label: 'A', tierNumber: 2, defaultPickCount: 1 },
        { tierKey: 'b', label: 'B', tierNumber: 1, defaultPickCount: 1 },
      ],
    });

    expect(update).toHaveBeenCalledWith({ where: { id: 'tier-a' }, data: { tierNumber: -2 } });
    expect(update).toHaveBeenCalledWith({ where: { id: 'tier-b' }, data: { tierNumber: -3 } });
  });
});

describe('GolfTierService.replaceGolfTierAssignments', () => {
  it('pool-master-piv rejects an unknown tier key without writing anything', async () => {
    const upsert = jest.fn();
    const prisma = {
      sportEventGolfTier: { findMany: jest.fn().mockResolvedValue([{ id: 'tier-1', tierKey: 'tier-1' }]) },
      sportEventParticipant: { findMany: jest.fn().mockResolvedValue([{ id: 'sep-1' }]) },
      sportEventParticipantGolfValuation: { upsert },
      $transaction: jest.fn(),
    };
    const service = new GolfTierService(prisma as any);

    await expect(
      service.replaceGolfTierAssignments({
        sportEventId: 'event-1',
        assignments: [{ sportEventParticipantId: 'sep-1', tierKey: 'unknown-tier', tierOrderIndex: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_TIER_KEY', statusCode: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('pool-master-piv rejects a sportEventParticipantId that does not belong to this sport event', async () => {
    const prisma = {
      sportEventGolfTier: { findMany: jest.fn().mockResolvedValue([{ id: 'tier-1', tierKey: 'tier-1' }]) },
      sportEventParticipant: { findMany: jest.fn().mockResolvedValue([]) },
      sportEventParticipantGolfValuation: { upsert: jest.fn() },
      $transaction: jest.fn(),
    };
    const service = new GolfTierService(prisma as any);

    await expect(
      service.replaceGolfTierAssignments({
        sportEventId: 'event-1',
        assignments: [{ sportEventParticipantId: 'sep-other-event', tierKey: 'tier-1', tierOrderIndex: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'FIELD_ENTRY_NOT_FOUND', statusCode: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('pool-master-piv applies the full desired state in one transaction with tierAssignedSource=MANUAL', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      sportEventGolfTier: { findMany: jest.fn().mockResolvedValue([{ id: 'tier-1', tierKey: 'tier-1' }]) },
      sportEventParticipant: { findMany: jest.fn().mockResolvedValue([{ id: 'sep-1' }]) },
      sportEventParticipantGolfValuation: { upsert },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    const service = new GolfTierService(prisma as any);
    jest.spyOn(service, 'getEffectiveTiersForSportEvent').mockResolvedValue([]);

    await service.replaceGolfTierAssignments({
      sportEventId: 'event-1',
      assignments: [{ sportEventParticipantId: 'sep-1', tierKey: 'tier-1', tierOrderIndex: 3 }],
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { sportEventParticipantId: 'sep-1' },
      create: { sportEventParticipantId: 'sep-1', sportEventGolfTierId: 'tier-1', tierOrderIndex: 3, tierAssignedSource: GolfValuationSource.MANUAL },
      update: { sportEventGolfTierId: 'tier-1', tierOrderIndex: 3, tierAssignedSource: GolfValuationSource.MANUAL },
    });
  });
});

describe('GolfTierService.autoAssignGolfPrices', () => {
  it('pool-master-piv delegates to the already-tested deriveGolfPrices with the seeded field\'s seedNumbers', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      sportEventParticipant: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'sep-1', seedNumber: 1 },
          { id: 'sep-2', seedNumber: 2 },
        ]),
      },
      sportEventParticipantGolfValuation: { upsert },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    const service = new GolfTierService(prisma as any);
    jest.spyOn(service, 'getEffectiveValuationsForSportEvent').mockResolvedValue([]);
    const deriveSpy = jest.spyOn(GolfSeedingAlgorithm, 'deriveGolfPrices');

    await service.autoAssignGolfPrices({ sportEventId: 'event-1', minPrice: 10, maxPrice: 50, random: () => 0.5 });

    expect(prisma.sportEventParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sportEventId: 'event-1', isActive: true, seedNumber: { not: null } } }),
    );
    expect(deriveSpy).toHaveBeenCalledWith(
      [{ participantId: 'sep-1', seedNumber: 1 }, { participantId: 'sep-2', seedNumber: 2 }],
      10,
      50,
      expect.any(Function),
    );
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      where: { sportEventParticipantId: 'sep-1' },
      create: expect.objectContaining({ priceAssignedSource: GolfValuationSource.AUTO_ODDS }),
    });
  });

  it('pool-master-piv returns an empty list and writes nothing when no field participant has a seedNumber yet', async () => {
    const upsert = jest.fn();
    const prisma = {
      sportEventParticipant: { findMany: jest.fn().mockResolvedValue([]) },
      sportEventParticipantGolfValuation: { upsert },
      $transaction: jest.fn(),
    };
    const service = new GolfTierService(prisma as any, { warn: jest.fn() } as any);

    const result = await service.autoAssignGolfPrices({ sportEventId: 'event-1', minPrice: 10, maxPrice: 50 });

    expect(result).toEqual([]);
    expect(upsert).not.toHaveBeenCalled();
  });
});
