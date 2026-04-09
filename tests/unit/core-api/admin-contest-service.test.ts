import { ContestService, ContestNotFoundError } from '../../../packages/core-api/src/modules/admin/contest-service';

jest.mock('../../../packages/core-api/src/modules/admin/admin-audit-service', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

function createMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    contest: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'contest-1',
        name: 'Bracket Battle',
      }),
    },
    contestEntry: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'entry-1',
          totalScore: 18,
          standingsPosition: 2,
        },
        {
          id: 'entry-2',
          totalScore: 12,
          standingsPosition: 1,
        },
      ]),
      update: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

describe('Admin ContestService', () => {
  it('recalculates standings using contest entries only', async () => {
    const prisma = createMockPrisma();
    const service = new ContestService(prisma as any);

    const result = await service.recalculateStandings(
      'contest-1',
      'admin-1',
      'admin@example.com',
    );

    expect(prisma.contestEntry.update).toHaveBeenCalledTimes(2);
    expect(prisma.contestEntry.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'entry-1' },
      data: { standingsPosition: 1 },
    });
    expect(prisma.contestEntry.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'entry-2' },
      data: { standingsPosition: 2 },
    });
    expect(result.rankChanges).toEqual([
      { entryId: 'entry-1', oldRank: 2, newRank: 1 },
      { entryId: 'entry-2', oldRank: 1, newRank: 2 },
    ]);
  });

  it('throws when the contest does not exist', async () => {
    const prisma = createMockPrisma({
      contest: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    });
    const service = new ContestService(prisma as any);

    await expect(
      service.recalculateStandings('missing', 'admin-1', 'admin@example.com'),
    ).rejects.toThrow(new ContestNotFoundError('missing'));
  });
});
