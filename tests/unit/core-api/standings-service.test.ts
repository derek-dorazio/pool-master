import { StandingsService, StandingsError } from '../../../packages/core-api/src/modules/standings/service';

describe('StandingsService', () => {
  it('throws STANDINGS_UNAVAILABLE when no persisted standings exist', async () => {
    const prisma = {
      contestStanding: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      contestEntry: {
        findMany: jest.fn(),
      },
    } as any;

    const service = new StandingsService(prisma);

    await expect(service.getStandings('contest-1')).rejects.toMatchObject<Partial<StandingsError>>({
      code: 'STANDINGS_UNAVAILABLE',
      statusCode: 409,
    });

    expect(prisma.contestEntry.findMany).not.toHaveBeenCalled();
  });
});
