import { StandingsService, StandingsError } from '../../../packages/core-api/src/modules/standings/service';

describe('StandingsService', () => {
  it('throws STANDINGS_UNAVAILABLE when no contest entries exist', async () => {
    const prisma = {
      contestEntry: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;

    const service = new StandingsService(prisma);

    await expect(service.getStandings('contest-1')).rejects.toMatchObject<Partial<StandingsError>>({
      code: 'STANDINGS_UNAVAILABLE',
      statusCode: 409,
    });
  });
});
