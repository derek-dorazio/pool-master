/**
 * requireSport is the one "no Sport row exists for this sport" failure mode, shared by
 * every sport-catalog and golf service rather than each writing its own lookup.
 */
import { requireSport } from '../../../packages/core-api/src/modules/sport-catalog/sport-row';
import { SportCatalogError } from '../../../packages/core-api/src/modules/sport-catalog/errors';
import { fakeSportRepo } from '../../support/repo-fakes';

describe('requireSport', () => {
  it('returns the Sport row when one exists for the sport', async () => {
    const sports = fakeSportRepo({ findByName: jest.fn().mockResolvedValue({ id: 'sport-golf', name: 'GOLF' }) });

    await expect(requireSport(sports, 'GOLF' as never)).resolves.toMatchObject({ id: 'sport-golf' });
  });

  it('throws a 404 SportCatalogError SPORT_NOT_FOUND when no Sport row exists', async () => {
    const attempt = requireSport(fakeSportRepo(), 'GOLF' as never);

    await expect(attempt).rejects.toBeInstanceOf(SportCatalogError);
    await expect(attempt).rejects.toMatchObject({ code: 'SPORT_NOT_FOUND', statusCode: 404 });
  });
});
