import { GolfTierSource, GolfValuationSource } from '@poolmaster/shared/domain';
import {
  DEFAULT_TIER_COUNT,
  GolfTierService,
} from '../../../packages/core-api/src/modules/golf/golf-tier-service';

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
          { sportEventParticipantId: 'sep-1', participantId: 'participant-1', tierOrderIndex: 1 },
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
