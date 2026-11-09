import { RefreshTokenRetention, REFRESH_TOKENS_KEPT_DAYS } from '../../../packages/core-api/src/modules/auth/refresh-token-retention';
import { asPrismaClient } from '../../support/prisma-double';

// The nightly refresh-token purge (#1175): rows expired longer than REFRESH_TOKENS_KEPT_DAYS go,
// a batch at a time, by id; nothing is deleted when no row is that old.

const NOW = new Date('2026-11-09T08:00:00.000Z');

describe('RefreshTokenRetention.purge', () => {
  it('deletes the tokens expired before the kept days by id, and answers how many went', async () => {
    const findMany = jest.fn().mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }]);
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 });

    const purged = await new RefreshTokenRetention(asPrismaClient({ refreshToken: { findMany, deleteMany } })).purge(NOW);

    expect(purged).toBe(2);
    const cutoff = new Date(NOW.getTime() - REFRESH_TOKENS_KEPT_DAYS * 24 * 60 * 60_000);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { expiresAt: { lt: cutoff } } }));
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['t1', 't2'] } } });
  });

  it('deletes nothing when no token is old enough', async () => {
    const deleteMany = jest.fn();

    const purged = await new RefreshTokenRetention(asPrismaClient({ refreshToken: { findMany: jest.fn().mockResolvedValue([]), deleteMany } })).purge(NOW);

    expect(purged).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
