import { StandingsRollup } from '../../../packages/core-api/src/modules/scoring/rollup/standings-rollup';

describe('StandingsRollup', () => {
  it('persists rankings onto contest entries without writing legacy contest standings', async () => {
    const contestEntryUpdate = jest.fn().mockResolvedValue(undefined);
    const transaction = jest.fn().mockImplementation(async (operations: unknown[]) => Promise.all(operations as Promise<unknown>[]));
    const publish = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      $transaction: transaction,
      contestEntry: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'entry-1', totalScore: 15 },
          { id: 'entry-2', totalScore: 10 },
        ]),
        update: contestEntryUpdate,
      },
    } as any;

    const rollup = new StandingsRollup({
      eventBus: { publish } as any,
      prisma,
    });

    const result = await rollup.rollupContest('contest-1');

    expect(result).toEqual(
      expect.objectContaining({
        contestId: 'contest-1',
        entriesUpdated: 2,
        rankChanges: 2,
      }),
    );
    expect(contestEntryUpdate).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: { standingsPosition: 1 },
    });
    expect(contestEntryUpdate).toHaveBeenCalledWith({
      where: { id: 'entry-2' },
      data: { standingsPosition: 2 },
    });
    expect(publish).toHaveBeenCalledWith(
      'standings.updated',
      expect.objectContaining({
        contestId: 'contest-1',
        standings: [
          expect.objectContaining({ entryId: 'entry-1', rank: 1, totalScore: 15 }),
          expect.objectContaining({ entryId: 'entry-2', rank: 2, totalScore: 10 }),
        ],
      }),
    );
  });

  describe('pool-master-rop.78.7 — rankDirection (golf-roster lowest-total-wins)', () => {
    it('orders ascending and ranks lower totalScore first when rankDirection: LOWER_IS_BETTER', async () => {
      const contestEntryFindMany = jest.fn().mockImplementation(async (args: any) => {
        // Simulate Prisma's ORDER BY direction by sorting our fixture rows
        // the way the implementation asks for them.
        const rows = [
          { id: 'entry-rory', totalScore: -5 },
          { id: 'entry-tiger', totalScore: 2 },
          { id: 'entry-rookie', totalScore: 10 },
        ];
        const direction = args?.orderBy?.[0]?.totalScore ?? 'desc';
        const sorted = rows.slice().sort((a, b) =>
          direction === 'asc' ? a.totalScore - b.totalScore : b.totalScore - a.totalScore,
        );
        return sorted;
      });
      const contestEntryUpdate = jest.fn().mockResolvedValue(undefined);
      const transaction = jest.fn().mockImplementation(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
      const publish = jest.fn().mockResolvedValue(undefined);

      const rollup = new StandingsRollup({
        eventBus: { publish } as any,
        prisma: {
          $transaction: transaction,
          contestEntry: {
            findMany: contestEntryFindMany,
            update: contestEntryUpdate,
          },
        } as any,
      });

      const result = await rollup.rollupContest('contest-golf', { rankDirection: 'LOWER_IS_BETTER' });

      // Defect-proof regression: pre-fix the rollup hardcoded `desc`, so an
      // entry at +10 would lead the leaderboard. Lower-is-better must put
      // `entry-rory` (-5) at rank 1, then `entry-tiger` (+2) at rank 2,
      // then `entry-rookie` (+10) at rank 3.
      expect(contestEntryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { contestId: 'contest-golf' },
          orderBy: [{ totalScore: 'asc' }, { id: 'asc' }],
        }),
      );
      expect(result.entriesUpdated).toBe(3);
      expect(publish).toHaveBeenCalledWith(
        'standings.updated',
        expect.objectContaining({
          standings: [
            expect.objectContaining({ entryId: 'entry-rory', rank: 1, totalScore: -5 }),
            expect.objectContaining({ entryId: 'entry-tiger', rank: 2, totalScore: 2 }),
            expect.objectContaining({ entryId: 'entry-rookie', rank: 3, totalScore: 10 }),
          ],
        }),
      );
      expect(contestEntryUpdate).toHaveBeenCalledWith({
        where: { id: 'entry-rory' },
        data: { standingsPosition: 1 },
      });
      expect(contestEntryUpdate).toHaveBeenCalledWith({
        where: { id: 'entry-rookie' },
        data: { standingsPosition: 3 },
      });
    });

    it('still orders descending (HIGHER_IS_BETTER) when no rankDirection is supplied', async () => {
      const contestEntryFindMany = jest.fn().mockResolvedValue([
        { id: 'entry-a', totalScore: 100 },
        { id: 'entry-b', totalScore: 50 },
      ]);
      const transaction = jest.fn().mockImplementation(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
      const rollup = new StandingsRollup({
        eventBus: { publish: jest.fn().mockResolvedValue(undefined) } as any,
        prisma: {
          $transaction: transaction,
          contestEntry: {
            findMany: contestEntryFindMany,
            update: jest.fn().mockResolvedValue(undefined),
          },
        } as any,
      });

      await rollup.rollupContest('contest-default');

      expect(contestEntryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ totalScore: 'desc' }, { id: 'asc' }],
        }),
      );
    });
  });
});
