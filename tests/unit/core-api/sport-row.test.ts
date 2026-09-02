/**
 * Unit tests for the shared requireSportRow helper (extracted from
 * SportLeagueService in pool-master-608 so the golf player routes and
 * SportLeagueService share one "no Sport row exists" failure mode instead of
 * two independently-drifting lookups).
 */
import { requireSportRow } from '../../../packages/core-api/src/modules/sport-catalog/sport-row';
import { SportCatalogError } from '../../../packages/core-api/src/modules/sport-catalog/errors';

describe('requireSportRow', () => {
  it('pool-master-608 returns the Sport row when one exists for the given sport', async () => {
    const prisma = { sport: { findUnique: jest.fn().mockResolvedValue({ id: 'sport-golf' }) } };

    const result = await requireSportRow(prisma as any, 'GOLF' as any);

    expect(prisma.sport.findUnique).toHaveBeenCalledWith({ where: { name: 'GOLF' } });
    expect(result).toEqual({ id: 'sport-golf' });
  });

  it('pool-master-608 throws a 404 SportCatalogError when no Sport row exists', async () => {
    const prisma = { sport: { findUnique: jest.fn().mockResolvedValue(null) } };

    await expect(requireSportRow(prisma as any, 'GOLF' as any)).rejects.toMatchObject({
      name: 'SportCatalogError',
      code: 'SPORT_NOT_FOUND',
      statusCode: 404,
    });
    await expect(requireSportRow(prisma as any, 'GOLF' as any)).rejects.toBeInstanceOf(SportCatalogError);
  });
});
