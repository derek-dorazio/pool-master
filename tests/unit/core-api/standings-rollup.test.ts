import { StandingsRollup } from '../../../packages/core-api/src/modules/scoring/rollup/standings-rollup';

describe('StandingsRollup', () => {
  it('persists rankings onto contest entries without writing legacy contest standings', async () => {
    const getLeaderboard = jest.fn().mockResolvedValue([
      { entryId: 'entry-1', total: 15 },
      { entryId: 'entry-2', total: 10 },
    ]);
    const contestEntryUpdate = jest.fn().mockResolvedValue(undefined);
    const transaction = jest.fn().mockImplementation(async (operations: unknown[]) => Promise.all(operations as Promise<unknown>[]));
    const publish = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      $transaction: transaction,
      contestEntry: {
        update: contestEntryUpdate,
      },
      contestStanding: {
        upsert: jest.fn(),
      },
    } as any;

    const rollup = new StandingsRollup({
      eventBus: { publish } as any,
      scoreStore: { getLeaderboard } as any,
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
    expect(prisma.contestStanding.upsert).not.toHaveBeenCalled();
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
});
